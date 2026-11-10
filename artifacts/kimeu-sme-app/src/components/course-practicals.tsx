import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CircleAlert, ClipboardCheck, History, Lock, RefreshCw, ShieldAlert } from 'lucide-react';
import {
  getGetKimeuPracticalsQueryKey, getGetKimeuTodayQueryKey, useGetKimeuPracticals, useSaveKimeuPractical,
} from '@workspace/api-client-react';
import type { PracticalRecord } from '@workspace/api-client-react';
import { practicalWindow } from '../lib/practical-window';
import { PracticalSchedule } from './practical-schedule';

const MAX_NOTES = 4000;

function laToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function resultLabel(r: string): string {
  if (r === 'Pass') return 'Passed';
  if (r === 'Fail') return 'Not passed';
  return r ? r : 'Not assessed';
}

function errorInfo(err: unknown): { status?: number; message: string } {
  const e = err as { status?: number; data?: { error?: string; code?: string }; message?: string } | null;
  const status = e?.status;
  const message = e?.data?.error || e?.message || 'The sign-off was not saved.';
  return { status, message };
}

type Draft = { recordKey: string; revision: string; result: 'Pass' | 'Fail' | ''; practicalDate: string; notes: string; kStarPerformed: boolean; kStarStars: string };

function slug(k: string) { return k.replace(/[^a-zA-Z0-9_-]/g, '_'); }

export function CoursePracticals({ workshopId, selectedEmail, onDirtyChange, onBusyChange }: {
  workshopId: string;
  selectedEmail: string;
  onDirtyChange: (dirty: boolean) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const queryKey = getGetKimeuPracticalsQueryKey(workshopId);
  const { data, isLoading, isError, refetch, isFetching } = useGetKimeuPracticals(workshopId, { query: { queryKey, refetchInterval: 60000, refetchOnWindowFocus: true } });
  const client = useQueryClient();
  const save = useSaveKimeuPractical();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [scheduleRecordKey, setScheduleRecordKey] = useState<string | null>(null);
  const [scheduleBusy, setScheduleBusy] = useState(false);
  const [selectedSession, setSelectedSession] = useState<{ scope: string; recordKey: string } | null>(null);
  const [formError, setFormError] = useState<{ text: string; conflict: boolean; latestRevision?: string } | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [editorSection, setEditorSection] = useState<'practical' | 'kstar'>('practical');
  const kStarSection = useRef<HTMLFieldSetElement>(null);

  const canSignOff = data?.canSignOff === true;
  const kStarCourse = workshopId === 'FW-KB';
  const records = data?.records ?? [];
  const matchingRecords = records.filter(record => record.clinicianEmail === selectedEmail);
  const sessionScope = `${workshopId}:${selectedEmail}`;
  const activeRecordKey = selectedSession?.scope === sessionScope ? selectedSession.recordKey
    : draft?.recordKey || scheduleRecordKey || (matchingRecords.length === 1 ? matchingRecords[0].recordKey : '');
  const visibleRecords = matchingRecords.filter(record => record.recordKey === activeRecordKey);
  const chooseSession = (recordKey: string) => {
    if (save.isPending || scheduleBusy) return;
    if ((draft || scheduleRecordKey) && !window.confirm('You have unsaved practical changes. Switching workshop sessions will discard them. Continue?')) return;
    setSelectedSession({ scope: sessionScope, recordKey });
    setDraft(null); setScheduleRecordKey(null); setFormError(null); setSuccess(null);
  };
  useEffect(() => { onDirtyChange(draft !== null || scheduleRecordKey !== null); }, [draft, scheduleRecordKey, onDirtyChange]);
  useEffect(() => { onBusyChange(save.isPending || scheduleBusy); }, [save.isPending, scheduleBusy, onBusyChange]);
  useEffect(() => {
    setDraft(null); setScheduleRecordKey(null); setSelectedSession(null); setFormError(null); setSuccess('');
  }, [selectedEmail, workshopId]);
  useEffect(() => () => { onDirtyChange(false); onBusyChange(false); }, [onDirtyChange, onBusyChange]);
  useEffect(() => {
    if (!draft || editorSection !== 'kstar') return;
    kStarSection.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    kStarSection.current?.querySelector('input')?.focus({ preventScroll: true });
  }, [draft?.recordKey, editorSection]);

  const open = (r: PracticalRecord, section: 'practical' | 'kstar' = 'practical') => {
    setSuccess(null); setFormError(null);
    setEditorSection(section);
    setDraft({ recordKey: r.recordKey, revision: r.revision, result: r.result === 'Pass' || r.result === 'Fail' ? r.result : '', practicalDate: r.practicalDate || laToday(), notes: '',
      kStarPerformed: r.kStarPerformed === true, kStarStars: r.kStarStars == null ? '' : String(r.kStarStars) });
  };

  const reviewLatest = async () => {
    const key = draft?.recordKey;
    const latest = await refetch();
    const record = latest.data?.records.find(r => r.recordKey === key);
    if (latest.isError || !record) {
      setFormError({ text: 'The latest record could not be loaded. Your draft is kept. Try again shortly.', conflict: true });
      return;
    }
    setFormError({
      text: 'Latest saved values are shown above. Your draft is unchanged. Review the result, practical date, K-Star and history before using this version for another save.',
      conflict: true, latestRevision: record.revision,
    });
  };

  const submit = (r: PracticalRecord) => {
    if (!draft || draft.recordKey !== r.recordKey || r.clinicianEmail !== selectedEmail) return;
    const notes = draft.notes.trim();
    const today = laToday();
    if (!draft.result) return setFormError({ text: 'Choose Passed or Not passed.', conflict: false });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.practicalDate)) return setFormError({ text: 'Enter the practical date.', conflict: false });
    if (r.sessionDate && draft.practicalDate < r.sessionDate.slice(0, 10)) return setFormError({ text: `The practical date cannot be before the workshop session (${r.sessionDate.slice(0, 10)}).`, conflict: false });
    if (draft.practicalDate > today) return setFormError({ text: 'The practical date cannot be in the future (Los Angeles time).', conflict: false });
    if (draft.result === 'Fail' && !notes) return setFormError({ text: 'Notes are required when the result is Not passed.', conflict: false });
    if (draft.notes.length > MAX_NOTES) return setFormError({ text: `Notes are limited to ${MAX_NOTES} characters.`, conflict: false });
    if (kStarCourse && draft.kStarPerformed && !/^[0-4]$/.test(draft.kStarStars)) return setFormError({ text: 'Select a K-Star test result from 0 to 4. An attempted test without an award is 0.', conflict: false });
    setFormError(null);
    const sent = { ...draft };
    save.mutate({ workshopId, data: { recordKey: sent.recordKey, revision: sent.revision, result: sent.result as 'Pass' | 'Fail', practicalDate: sent.practicalDate, notes,
      ...(kStarCourse ? { kStarPerformed: sent.kStarPerformed, kStarStars: sent.kStarPerformed ? Number(sent.kStarStars) : null } : {}) } }, {
      onSuccess: (ws) => {
        client.setQueryData(queryKey, ws);
        client.invalidateQueries({ queryKey: getGetKimeuTodayQueryKey() });
        client.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === 'string' && (q.queryKey[0] as string).startsWith('/api/kimeu/sessions/') });
        const back = ws.records.find((x) => x.recordKey === sent.recordKey);
        if (back && back.result === sent.result && back.practicalDate === sent.practicalDate) {
          setDraft(null);
          setSuccess(`${back.name || back.clinicianEmail}: ${resultLabel(back.result)} on ${back.practicalDate} saved and confirmed.${kStarCourse ? ` K-Star: ${back.kStarHighestEarned ? `highest earned KR${back.kStarHighestEarned} retained` : back.kStarPerformed ? 'attempt recorded; no star earned' : 'not performed'}.` : ''}`);
        } else {
          setFormError({ text: 'The server responded but the saved result could not be confirmed on readback. Reload and check before trying again.', conflict: true });
        }
      },
      onError: (err) => {
        const { status, message } = errorInfo(err);
        if (status === 409) setFormError({ text: 'This record changed since you opened it. Your draft is kept. Review the latest saved values before saving again; no page refresh is needed.', conflict: true });
        else if (status === 403) setFormError({ text: `Not permitted: ${message}`, conflict: false });
        else setFormError({ text: `${message} Your draft is kept. Review the latest saved values before retrying, since the server may already have saved it.`, conflict: true });
      },
    });
  };

  return <section className="practicals" aria-label="Post-workshop practical" data-testid="section-practicals">
    <div className="section-title-row">
      <div><span className="section-kicker">POST-WORKSHOP / REGIONAL DIRECTOR</span><h2>{kStarCourse ? 'RD practical completion & K-Star' : 'RD practical completion'}</h2></div>
      <button type="button" className="button-quiet" onClick={() => refetch()} disabled={isFetching || save.isPending || scheduleBusy} data-testid="button-refresh-practicals"><RefreshCw size={14} className={isFetching ? 'spin' : ''} /> Refresh</button>
    </div>
    {!isLoading && !isError && <p className="practicals-intro" data-testid="text-practicals-access">
      {canSignOff ? <>Use Schedule practical to plan a date within two weeks after any workshop, without marking completion. Use Record RD practical only after the practical happens; completion requires saved attendance and an elapsed workshop session.{kStarCourse && <> Use Record K-Star result for the optional fitness test and 0–4 result.</>}</> : <><Lock size={13} aria-hidden="true" /> Read only. Only the assigned Regional Director or an admin can schedule or record practical results{kStarCourse ? ' and K-Star recognition' : ''}.</>}
    </p>}
    {success && <div className="inline-message inline-message-success" role="status" data-testid="status-practical-success">{success}</div>}
    {isError && data && <div className="inline-message inline-message-error" role="alert">The latest refresh failed. Previously loaded records and your draft are kept. Try refreshing records again shortly.</div>}
    {isLoading ? <div className="session-list" aria-label="Loading practicals">{[0, 1].map((i) => <div className="session-skeleton" key={i}><div className="skeleton skeleton-line w-40" /><div className="skeleton skeleton-line w-56" /></div>)}</div>
      : isError && !data ? <div className="state-card state-error" role="alert" data-testid="error-practicals"><div className="state-icon"><CircleAlert size={18} /></div><div><h3>Practicals could not load</h3><p>No records are shown rather than guessing. Try again shortly.</p><button type="button" className="button-quiet" onClick={() => refetch()} data-testid="button-retry-practicals"><RefreshCw size={14} /> Try again</button></div></div>
      : !matchingRecords.length ? <div className="state-card" data-testid="empty-practicals"><div className="state-icon"><ClipboardCheck size={18} /></div><div><h3>Save this PT’s attendance to unlock RD sign-off</h3><p>Checking attendance without clicking Save does not create a practical record. After saving, Record RD practical{kStarCourse ? ' and Record K-Star result' : ''} will appear here for an eligible session. Regional Directors see only their assigned PTs.</p></div></div>
      : <>
      {matchingRecords.length > 1 && <div className="ct-panel" data-testid="panel-practical-sessions">
        <label className="ct-field">Workshop session for RD practical
          <select value={activeRecordKey} onChange={event => chooseSession(event.target.value)} disabled={save.isPending || scheduleBusy} data-testid="select-practical-session">
            <option value="">Select a workshop session</option>
            {[...matchingRecords].sort((a, b) => b.sessionDate.localeCompare(a.sessionDate)).map(record =>
              <option key={record.recordKey} value={record.recordKey}>{record.sessionDate} — {resultLabel(record.result)}</option>)}
          </select>
        </label>
        <p className="ct-explain">This PT has {matchingRecords.length} saved workshop sessions, not {matchingRecords.length} required practicals for one session. Choose a date to view or edit one record. All other sessions and their history are retained.</p>
        {!visibleRecords.length && <p role="status">Select the workshop date above to view its practical record.</p>}
      </div>}
      <ul className="practical-list">
        {visibleRecords.map((r) => {
          const id = slug(r.recordKey);
          const editing = draft?.recordKey === r.recordKey;
          const window = practicalWindow(r.sessionDate, editing ? draft?.practicalDate || '' : r.practicalDate || '', laToday());
          const res = r.result;
          return <li key={r.recordKey} className="practical-card" data-testid={`card-practical-${id}`}>
            <div className="practical-head">
              <div className="practical-who"><strong data-testid={`text-practical-name-${id}`}>{r.name || r.clinicianEmail}</strong><small>{r.clinicianEmail}</small></div>
              <span className={`practical-result ${res === 'Pass' ? 'is-pass' : res === 'Fail' ? 'is-fail' : ''}`} data-testid={`status-practical-${id}`}>{resultLabel(res)}</span>
            </div>
            <dl className="practical-facts">
              <div><dt>Session</dt><dd>{r.sessionDate || 'Not set'}</dd></div>
              <div><dt>Attended</dt><dd>{r.attended ? 'Yes' : 'No'}</dd></div>
              <div><dt>Practical</dt><dd data-testid={`text-practical-date-${id}`}>{r.practicalDate || 'None'}</dd></div>
              <div><dt>Scheduled practical</dt><dd data-testid={`text-practical-schedule-${id}`}>{r.scheduledDate || 'Not scheduled'}</dd></div>
              <div><dt>Scored by</dt><dd data-testid={`text-practical-scorer-${id}`}>{r.scoredBy || 'None'}</dd></div>
              <div><dt>RD</dt><dd>{r.rd || 'Not set'}</dd></div>
            </dl>
            {window && <p className={`practical-window ${window.onTime ? 'is-on-time' : 'is-outside-window'}`} data-testid={`status-practical-window-${id}`}>
              <strong>{window.onTime ? (editing || r.practicalDate ? 'Within two-week window' : 'Within two-week window — ready for practical') : window.future ? 'Workshop has not occurred yet' : 'Outside preferred two-week window'}</strong>
              <span>Practical scheduling window: {window.start} through {window.end}. Future dates in this range may be scheduled separately. Completion is recorded only after the practical happens.</span>
            </p>}
            {kStarCourse && <p className="ct-meta" data-testid={`text-k-star-saved-${id}`}>K-Star: {r.kStarPerformed === null || r.kStarPerformed === undefined ? 'Not recorded' : r.kStarPerformed ? r.kStarStars ? `KR${r.kStarStars}` : r.kStarStars === 0 ? 'Attempted; no star earned' : 'Performed; result not recorded' : 'Not performed'}{r.kStarHighestEarned ? ` · Highest earned: KR${r.kStarHighestEarned}` : ''}</p>}
            {r.history.length > 0 && <details className="practical-history" data-testid={`history-practical-${id}`}>
              <summary><History size={13} aria-hidden="true" /> History ({r.history.length})</summary>
              <ol>{r.history.map((h) => <li key={h.id}><span>{h.created} / {h.author}</span><p>{h.note}</p></li>)}</ol>
            </details>}
            {canSignOff && scheduleRecordKey !== r.recordKey && <button type="button" className="button-quiet" disabled={draft !== null || scheduleRecordKey !== null || save.isPending} onClick={() => { setSuccess(null); setScheduleRecordKey(r.recordKey); }} data-testid={`button-schedule-practical-${id}`}>{r.scheduledDate ? 'Edit practical schedule' : 'Schedule practical'}</button>}
            {canSignOff && scheduleRecordKey === r.recordKey && <PracticalSchedule workshopId={workshopId} record={r} today={laToday()} onBusyChange={setScheduleBusy} onClose={() => setScheduleRecordKey(null)} onSaved={message => { setScheduleRecordKey(null); setSuccess(message); }} onReview={async () => { const latest = await refetch(); if (latest.isError || !latest.data) throw new Error('Latest records unavailable'); return latest.data; }} />}
            {canSignOff && !editing && (r.eligible
              ? <div className="practical-entry-actions">
                <button type="button" className="practical-open" onClick={() => open(r)} disabled={save.isPending || scheduleRecordKey !== null} data-testid={`button-assess-${id}`}>{res ? 'Edit RD practical' : 'Record RD practical'}</button>
                {kStarCourse && <button type="button" className="button-quiet" onClick={() => open(r, 'kstar')} disabled={save.isPending || scheduleRecordKey !== null} data-testid={`button-k-star-${id}`}>Record K-Star result</button>}
              </div>
              : <p className="practical-ineligible" data-testid={`text-ineligible-${id}`}>Not yet eligible: attendance must be Yes and the session date must have passed.</p>)}
            {canSignOff && editing && draft && <form className="practical-form" onSubmit={(e) => { e.preventDefault(); submit(r); }} data-testid={`form-practical-${id}`}>
              <fieldset className="practical-choice"><legend>RD practical completion</legend>
                {(['Pass', 'Fail'] as const).map((v) => <label key={v} className={draft.result === v ? 'is-on' : ''}><input type="radio" disabled={save.isPending} name={`result-${id}`} checked={draft.result === v} onChange={() => setDraft({ ...draft, result: v })} data-testid={`radio-result-${v.toLowerCase()}-${id}`} />{v === 'Pass' ? 'Passed — practical complete' : 'Not passed'}</label>)}
              </fieldset>
              <label>Actual practical date<input type="date" disabled={save.isPending} value={draft.practicalDate} min={r.sessionDate?.slice(0, 10) || undefined} max={laToday()} onChange={(e) => setDraft({ ...draft, practicalDate: e.target.value })} data-testid={`input-practical-date-${id}`} /></label>
              <label>Notes {draft.result === 'Fail' ? '(required)' : '(optional)'}<textarea disabled={save.isPending} rows={3} maxLength={MAX_NOTES} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} placeholder="What was observed. No patient identifiers." data-testid={`input-practical-notes-${id}`} /></label>
              {kStarCourse && <fieldset ref={kStarSection} className="k-star-fields" disabled={save.isPending}>
                <legend>Optional K-Star recognition</legend>
                <label className="k-star-check"><input type="checkbox" checked={draft.kStarPerformed} onChange={(e) => setDraft({ ...draft, kStarPerformed: e.target.checked, kStarStars: e.target.checked ? draft.kStarStars : '' })} data-testid={`checkbox-k-star-${id}`} />K-Star fitness test performed</label>
                <label>K-Star earned {draft.kStarPerformed ? '(required)' : '(check performed to select)'}<select required={draft.kStarPerformed} disabled={!draft.kStarPerformed} value={draft.kStarStars} onChange={(e) => setDraft({ ...draft, kStarStars: e.target.value })} data-testid={`select-k-star-${id}`}>
                  <option value="">{draft.kStarPerformed ? 'Select a result' : 'Test not performed'}</option>
                  <option value="0">Attempted — no star earned</option>
                  {[1, 2, 3, 4].map(level => <option key={level} value={level}>{level} {level === 1 ? 'Star' : 'Stars'} — KR{level}</option>)}
                </select></label>
                <p className="ct-meta">Optional and separate from course completion. A lower result or an unchecked test never removes a previously earned level.{r.kStarHighestEarned ? ` Highest earned: KR${r.kStarHighestEarned}.` : ''}</p>
              </fieldset>}
              <div className="practical-form-meta"><span><ShieldAlert size={12} aria-hidden="true" /> No PHI: never include patient names, dates of birth or record numbers.</span><span>{draft.notes.length}/{MAX_NOTES}</span></div>
              {formError && <div className="inline-message inline-message-error" role="alert" data-testid={`error-practical-${id}`}>{formError.text}{formError.conflict && <>
                <button type="button" className="practical-link" disabled={isFetching || save.isPending} onClick={reviewLatest} data-testid={`button-reload-practical-${id}`}>Review latest saved values</button>
                {formError.latestRevision && <button type="button" className="practical-link" disabled={save.isPending || formError.latestRevision !== r.revision} onClick={() => { setDraft({ ...draft, revision: formError.latestRevision! }); setFormError(null); }} data-testid={`button-use-reviewed-practical-${id}`}>Use reviewed version for this draft</button>}
              </>}</div>}
              <div className="close-actions">
                <button type="button" className="button-quiet" onClick={() => { setDraft(null); setFormError(null); }} disabled={save.isPending} data-testid={`button-cancel-practical-${id}`}>Cancel</button>
                <button type="submit" className="practical-save" disabled={save.isPending || formError?.conflict === true} data-testid={`button-save-practical-${id}`}>{save.isPending ? 'Saving...' : 'Save sign-off'}</button>
              </div>
            </form>}
          </li>;
        })}
      </ul></>}
  </section>;
}
