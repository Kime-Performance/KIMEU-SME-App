import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CircleAlert, ClipboardCheck, History, Lock, RefreshCw, ShieldAlert } from 'lucide-react';
import {
  getGetKimeuPracticalsQueryKey, getGetKimeuTodayQueryKey, useGetKimeuPracticals, useSaveKimeuPractical,
} from '@workspace/api-client-react';
import type { PracticalRecord } from '@workspace/api-client-react';

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

type Draft = { recordKey: string; revision: string; result: 'Pass' | 'Fail' | ''; practicalDate: string; notes: string };

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
  const [formError, setFormError] = useState<{ text: string; conflict: boolean } | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const canSignOff = data?.canSignOff === true;
  const records = data?.records ?? [];
  const matchingRecords = records.filter(record => record.clinicianEmail === selectedEmail);
  useEffect(() => { onDirtyChange(draft !== null); }, [draft, onDirtyChange]);
  useEffect(() => { onBusyChange(save.isPending); }, [save.isPending, onBusyChange]);
  useEffect(() => {
    setDraft(null); setFormError(null); setSuccess('');
  }, [selectedEmail]);
  useEffect(() => () => { onDirtyChange(false); onBusyChange(false); }, [onDirtyChange, onBusyChange]);

  const open = (r: PracticalRecord) => {
    setSuccess(null); setFormError(null);
    setDraft({ recordKey: r.recordKey, revision: r.revision, result: r.result === 'Pass' || r.result === 'Fail' ? r.result : '', practicalDate: r.practicalDate || '', notes: '' });
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
    setFormError(null);
    const sent = { ...draft };
    save.mutate({ workshopId, data: { recordKey: sent.recordKey, revision: sent.revision, result: sent.result as 'Pass' | 'Fail', practicalDate: sent.practicalDate, notes } }, {
      onSuccess: (ws) => {
        client.setQueryData(queryKey, ws);
        client.invalidateQueries({ queryKey: getGetKimeuTodayQueryKey() });
        client.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === 'string' && (q.queryKey[0] as string).startsWith('/api/kimeu/sessions/') });
        const back = ws.records.find((x) => x.recordKey === sent.recordKey);
        if (back && back.result === sent.result && back.practicalDate === sent.practicalDate) {
          setDraft(null);
          setSuccess(`${back.name || back.clinicianEmail}: ${resultLabel(back.result)} on ${back.practicalDate} saved and confirmed.`);
        } else {
          setFormError({ text: 'The server responded but the saved result could not be confirmed on readback. Reload and check before trying again.', conflict: true });
        }
      },
      onError: (err) => {
        const { status, message } = errorInfo(err);
        if (status === 409) setFormError({ text: 'This record changed since you opened it (someone else may have signed it off). Your draft is kept below. Reload to see the latest, then reassess.', conflict: true });
        else if (status === 403) setFormError({ text: `Not permitted: ${message}`, conflict: false });
        else setFormError({ text: message, conflict: false });
      },
    });
  };

  return <section className="practicals" aria-label="Post-workshop practical" data-testid="section-practicals">
    <div className="section-title-row">
      <div><span className="section-kicker">POST-WORKSHOP</span><h2>Practical sign-off</h2></div>
      <button type="button" className="button-quiet" onClick={() => refetch()} disabled={isFetching} data-testid="button-refresh-practicals"><RefreshCw size={14} className={isFetching ? 'spin' : ''} /> Refresh</button>
    </div>
    {!isLoading && !isError && <p className="practicals-intro" data-testid="text-practicals-access">
      {canSignOff ? <>Record whether each attendee demonstrated the skill in a real practical. Eligible rows need confirmed attendance and an elapsed session.</> : <><Lock size={13} aria-hidden="true" /> Read only. Only the assigned Regional Director or an admin can record practical results.</>}
    </p>}
    {success && <div className="inline-message inline-message-success" role="status" data-testid="status-practical-success">{success}</div>}
    {isLoading ? <div className="session-list" aria-label="Loading practicals">{[0, 1].map((i) => <div className="session-skeleton" key={i}><div className="skeleton skeleton-line w-40" /><div className="skeleton skeleton-line w-56" /></div>)}</div>
      : isError ? <div className="state-card state-error" role="alert" data-testid="error-practicals"><div className="state-icon"><CircleAlert size={18} /></div><div><h3>Practicals could not load</h3><p>No records are shown rather than guessing. Try again shortly.</p><button type="button" className="button-quiet" onClick={() => refetch()} data-testid="button-retry-practicals"><RefreshCw size={14} /> Try again</button></div></div>
      : !matchingRecords.length ? <div className="state-card" data-testid="empty-practicals"><div className="state-icon"><ClipboardCheck size={18} /></div><div><h3>No saved practical record for this PT</h3><p>Save attendance for the selected PT first. Checking an attendance box without saving does not create a practical record. Regional Directors see only their assigned PTs.</p></div></div>
      : <ul className="practical-list">
        {matchingRecords.map((r) => {
          const id = slug(r.recordKey);
          const editing = draft?.recordKey === r.recordKey;
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
              <div><dt>Scored by</dt><dd data-testid={`text-practical-scorer-${id}`}>{r.scoredBy || 'None'}</dd></div>
              <div><dt>RD</dt><dd>{r.rd || 'Not set'}</dd></div>
            </dl>
            {r.history.length > 0 && <details className="practical-history" data-testid={`history-practical-${id}`}>
              <summary><History size={13} aria-hidden="true" /> History ({r.history.length})</summary>
              <ol>{r.history.map((h) => <li key={h.id}><span>{h.created} / {h.author}</span><p>{h.note}</p></li>)}</ol>
            </details>}
            {canSignOff && !editing && (r.eligible
              ? <button type="button" className="practical-open" onClick={() => open(r)} disabled={save.isPending} data-testid={`button-assess-${id}`}>{res ? 'Reassess' : 'Assess'}</button>
              : <p className="practical-ineligible" data-testid={`text-ineligible-${id}`}>Not yet eligible: attendance must be Yes and the session date must have passed.</p>)}
            {canSignOff && editing && draft && <form className="practical-form" onSubmit={(e) => { e.preventDefault(); submit(r); }} data-testid={`form-practical-${id}`}>
              <fieldset className="practical-choice"><legend>Result</legend>
                {(['Pass', 'Fail'] as const).map((v) => <label key={v} className={draft.result === v ? 'is-on' : ''}><input type="radio" name={`result-${id}`} checked={draft.result === v} onChange={() => setDraft({ ...draft, result: v })} data-testid={`radio-result-${v.toLowerCase()}-${id}`} />{resultLabel(v)}</label>)}
              </fieldset>
              <label>Practical date<input type="date" value={draft.practicalDate} min={r.sessionDate?.slice(0, 10) || undefined} max={laToday()} onChange={(e) => setDraft({ ...draft, practicalDate: e.target.value })} data-testid={`input-practical-date-${id}`} /></label>
              <label>Notes {draft.result === 'Fail' ? '(required)' : '(optional)'}<textarea rows={3} maxLength={MAX_NOTES} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} placeholder="What was observed. No patient identifiers." data-testid={`input-practical-notes-${id}`} /></label>
              <div className="practical-form-meta"><span><ShieldAlert size={12} aria-hidden="true" /> No PHI: never include patient names, dates of birth or record numbers.</span><span>{draft.notes.length}/{MAX_NOTES}</span></div>
              {formError && <div className="inline-message inline-message-error" role="alert" data-testid={`error-practical-${id}`}>{formError.text}{formError.conflict && <> <button type="button" className="practical-link" onClick={() => refetch()} data-testid={`button-reload-practical-${id}`}>Reload records</button></>}</div>}
              <div className="close-actions">
                <button type="button" className="button-quiet" onClick={() => { setDraft(null); setFormError(null); }} disabled={save.isPending} data-testid={`button-cancel-practical-${id}`}>Cancel</button>
                <button type="submit" className="practical-save" disabled={save.isPending} data-testid={`button-save-practical-${id}`}>{save.isPending ? 'Saving...' : 'Save sign-off'}</button>
              </div>
            </form>}
          </li>;
        })}
      </ul>}
  </section>;
}
