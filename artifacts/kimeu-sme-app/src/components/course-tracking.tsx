import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CircleAlert, Lock, RefreshCw, UserCheck } from 'lucide-react';
import {
  getGetKimeuCourseTrackingQueryKey, getGetKimeuPracticalsQueryKey, getGetKimeuTodayQueryKey,
  useGetKimeuCourseTracking, useSaveKimeuCourseTracking,
} from '@workspace/api-client-react';
import type { CourseTracking, CourseTrackingPerson, TrackingMark } from '@workspace/api-client-react';

type Kind = 'attendance';
type Drafts = Record<Kind, Record<string, boolean>>;
const EMPTY: Drafts = { attendance: {} };

function laToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
const validDateStr = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d));
function errorInfo(err: unknown) {
  const e = err as { status?: number; data?: { error?: string }; message?: string } | null;
  return { status: e?.status, message: e?.data?.error || e?.message || 'The save did not complete.' };
}
function fmtTime(s: string) {
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s || 'Unknown' : d.toLocaleString('en-US', { timeZone: 'America/Los_Angeles', dateStyle: 'medium', timeStyle: 'short' }) + ' PT';
}
const slug = (k: string) => k.replace(/[^a-zA-Z0-9_-]/g, '_');
const serverValue = (p: CourseTrackingPerson, _kind: Kind) => p.attended;

export function CourseTracking({ workshopId, selectedEmail, onRosterChange, onRosterStatusChange, onDirtyChange, onBusyChange }: {
  workshopId: string;
  selectedEmail: string;
  onRosterChange: (people: CourseTrackingPerson[]) => void;
  onRosterStatusChange?: (status: 'loading' | 'ready' | 'error') => void;
  onDirtyChange: (dirty: boolean) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const client = useQueryClient();
  const [sessionDate, setSessionDate] = useState(laToday);
  const [drafts, setDrafts] = useState<Drafts>(EMPTY);
  const [baseRevision, setBaseRevision] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string; conflict?: boolean } | null>(null);
  const validDate = validDateStr(sessionDate);
  const queryKey = getGetKimeuCourseTrackingQueryKey(workshopId, sessionDate);
  const query = useGetKimeuCourseTracking(workshopId, sessionDate, {
    query: { queryKey, enabled: validDate, refetchInterval: 60000, refetchOnWindowFocus: true },
  });
  const save = useSaveKimeuCourseTracking();
  const data = query.data;
  const count = (k: Kind) => Object.keys(drafts[k]).length;
  const dirty = count('attendance') > 0;
  useEffect(() => {
    onRosterChange(data?.people ?? []);
  }, [data?.people, onRosterChange]);
  useEffect(() => {
    onRosterStatusChange?.(data ? 'ready' : query.isError ? 'error' : 'loading');
  }, [data, query.isError, onRosterStatusChange]);
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => { onBusyChange(save.isPending); }, [save.isPending, onBusyChange]);
  useEffect(() => {
    setDrafts(EMPTY); setBaseRevision(null); setMessage(null);
  }, [selectedEmail]);

  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    const guardNavigation = (event: MouseEvent) => {
      const anchor = (event.target as Element | null)?.closest('a[href]') as HTMLAnchorElement | null;
      if (!anchor || anchor.target === '_blank' || anchor.origin !== window.location.origin ||
          anchor.pathname === window.location.pathname) return;
      if (!window.confirm('You have unsaved checklist changes. Leaving this page will discard them. Continue?')) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    window.addEventListener('beforeunload', h);
    document.addEventListener('click', guardNavigation, true);
    return () => {
      window.removeEventListener('beforeunload', h);
      document.removeEventListener('click', guardNavigation, true);
    };
  }, [dirty]);

  const people = useMemo(() => {
    const list = data?.people ?? [];
    return list.filter((p) => p.email === selectedEmail);
  }, [data, selectedEmail]);

  function changeDate(next: string) {
    if (dirty && !window.confirm('You have unsaved checklist changes. Changing the date will discard them. Continue?')) return;
    setDrafts(EMPTY); setBaseRevision(null); setMessage(null); setSessionDate(next);
  }

  function toggle(kind: Kind, p: CourseTrackingPerson, checked: boolean) {
    if (!data || p.email !== selectedEmail) return;
    if (baseRevision === null) setBaseRevision(data.revision);
    setDrafts((d) => {
      const next = { ...d[kind] };
      if (checked === serverValue(p, kind)) delete next[p.email]; else next[p.email] = checked;
      return { ...d, [kind]: next };
    });
  }

  function discard(kind?: Kind) {
    if (!window.confirm(kind ? `Discard unsaved ${kind} changes?` : 'Discard all unsaved changes and reload from the sheet?')) return;
    const next = kind ? { ...drafts, [kind]: {} } : EMPTY;
    setDrafts(next);
    if (!Object.keys(next.attendance).length) setBaseRevision(null);
    setMessage(null);
    if (!kind) query.refetch();
  }

  function submit(kind: Kind) {
    if (!data) return;
    const marks: TrackingMark[] = Object.entries(drafts[kind]).filter(([email]) => email === selectedEmail).map(([email, checked]) => ({ email, checked }));
    if (!marks.length) return;
    setMessage(null);
    save.mutate({ workshopId, data: { sessionDate, revision: baseRevision ?? data.revision, kind, marks } }, {
      onSuccess: (result: CourseTracking) => {
        client.setQueryData(getGetKimeuCourseTrackingQueryKey(workshopId, sessionDate), result);
        client.invalidateQueries({ queryKey: getGetKimeuTodayQueryKey() });
        client.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === 'string' && (q.queryKey[0] as string).startsWith('/api/kimeu/sessions/') });
        client.invalidateQueries({ queryKey: getGetKimeuPracticalsQueryKey(workshopId) });
        const byEmail = new Map(result.people.map((p) => [p.email, p]));
        const confirmed = marks.filter((m) => { const p = byEmail.get(m.email); return p && serverValue(p, kind) === m.checked; }).length;
        setDrafts((d) => ({ ...d, [kind]: {} }));
        setBaseRevision(null);
        setMessage({ tone: confirmed === marks.length ? 'success' : 'error', text: `Attendance saved: ${confirmed} of ${marks.length} marks confirmed by the sheet.` });
      },
      onError: (err) => {
        const { status, message: text } = errorInfo(err);
        setMessage(status === 409
          ? { tone: 'error', conflict: true, text: 'Someone changed this checklist since you started. Your draft is kept. Discard and reload to see the latest marks, then reapply your changes.' }
          : { tone: 'error', text: `Not saved: ${text} Your draft is kept.` });
      },
    });
  }

  function renderList(kind: Kind) {
    if (!data) return null;
    const canSave = data.canSaveAttendance;
    const n = count(kind);
    return <section className="ct-panel" data-testid={`panel-${kind}`}>
      <div className="ct-panel-head">
        <div className="panel-heading"><div className="panel-icon"><UserCheck size={18} /></div><div><span className="section-kicker">LIVE WORKSHOP</span><h2>Attendance</h2></div></div>
        {n > 0 && <span className="ct-unsaved" data-testid={`text-unsaved-${kind}`}>{n} unsaved</span>}
      </div>
      <p className="ct-explain">Only boxes you change are sent. An unchecked box records "not attended" only if you explicitly unchecked it.</p>
      {!canSave && <div className="ct-readonly" data-testid={`status-readonly-${kind}`}><Lock size={13} /> Read-only for your role.</div>}
      <ul className="ct-list">
        {people.map((p) => {
          const id = slug(p.email);
          const checked = drafts[kind][p.email] ?? serverValue(p, kind);
          const changed = p.email in drafts[kind];
          return <li key={p.email} className={`ct-row${changed ? ' ct-changed' : ''}`} data-testid={`row-${kind}-${id}`}>
            <label className="ct-check">
              <input type="checkbox" checked={checked} disabled={!canSave || save.isPending} onChange={(e) => toggle(kind, p, e.target.checked)} data-testid={`checkbox-${kind}-${id}`} />
              <span className="ct-who"><strong data-testid={`text-name-${kind}-${id}`}>{p.name}</strong><small>{p.location || 'No location'}</small>
              </span>
              {changed && <span className="ct-flag">edited</span>}
            </label>
          </li>;
        })}
      </ul>
      {canSave && <div className="ct-actions">
        {n > 0 && <button type="button" className="button-quiet" onClick={() => discard(kind)} disabled={save.isPending} data-testid={`button-discard-${kind}`}>Discard</button>}
        <button type="button" className="button-primary" onClick={() => submit(kind)} disabled={!n || save.isPending} data-testid={`button-save-${kind}`}>
          {save.isPending ? 'Saving...' : `Save attendance${n ? ` (${n})` : ''}`}
        </button>
      </div>}
    </section>;
  }

  if (!selectedEmail && !query.isLoading && !query.isError) return <p className="ct-meta" data-testid="text-select-pt-first">Select a PT above to view their attendance and RD practical.</p>;
  return <section className="ct-root" aria-label="Course tracking" data-testid="section-course-tracking">
    <div className="section-title-row"><div><span className="section-kicker">PT CHECKLIST</span><h2>Workshop attendance</h2></div>
      <button type="button" className="button-quiet" onClick={() => query.refetch()} disabled={!validDate || query.isFetching} data-testid="button-refresh-tracking"><RefreshCw size={14} className={query.isFetching ? 'spin' : ''} /> Refresh</button></div>
    <div className="ct-toolbar">
      <label className="ct-field"><span>Workshop date</span>
        <input type="date" value={sessionDate} onChange={(e) => changeDate(e.target.value)} disabled={save.isPending} data-testid="input-session-date" /></label>
    </div>
    <p className="ct-meta">Nothing saves automatically. A workshop session is opened only when attendance is saved.{data && <> Roster refreshed <b data-testid="text-roster-refreshed">{fmtTime(data.rosterRefreshedAt)}</b>.</>}</p>
    <p className="ct-explain">{workshopId.startsWith('F-')
      ? 'Foundations workshop completion is calculated in the KIMEU sheet from attendance and RD practical Pass. Kajabi progress applies only to the separate Foundations assessment component.'
      : 'Overall completion is calculated in the KIMEU sheet from attendance, RD practical results, and Director-uploaded pre-course progress. No separate completion approval is needed here.'}</p>
    {message && <div className={`inline-message inline-message-${message.tone}`} role="status" data-testid="status-tracking-message">{message.text}
      {message.conflict && <button type="button" className="button-quiet ct-inline-btn" onClick={() => discard()} data-testid="button-discard-reload">Discard and reload</button>}</div>}
    {!validDate ? <div className="state-card state-error"><div className="state-icon"><CircleAlert size={18} /></div><div><h3>Choose a valid date</h3><p>Pick the workshop occurrence date to load the checklist.</p></div></div>
      : query.isLoading ? <div className="session-list" aria-label="Loading checklist">{[0, 1].map((i) => <div className="session-skeleton" key={i}><div className="skeleton skeleton-line w-40" /><div className="skeleton skeleton-line w-full" /><div className="skeleton skeleton-line w-56" /></div>)}</div>
      : query.isError && !data ? <div className="state-card state-error" role="alert"><div className="state-icon"><CircleAlert size={18} /></div><div><h3>Checklist could not load</h3><p>{errorInfo(query.error).message}</p><button type="button" className="button-quiet" onClick={() => query.refetch()} data-testid="button-retry-tracking"><RefreshCw size={14} /> Try again</button></div></div>
      : !data?.people.length ? <div className="state-card"><div className="state-icon"><UserCheck size={18} /></div><div><h3>No active clinical PTs</h3><p>The KIME roster returned no PTs for this course and date.</p></div></div>
      : <>
        {query.isError && <div className="inline-message inline-message-error">Latest refresh failed; showing last loaded marks.</div>}
        {!people.length && <p className="ct-meta" data-testid="text-no-search-results">The selected PT is not available in the current roster.</p>}
        <div className="ct-grid">{renderList('attendance')}</div>
      </>}
  </section>;
}
