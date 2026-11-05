import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CircleAlert, ClipboardCheck, FileText, Lock, Presentation, RefreshCw, Search, UserCheck } from 'lucide-react';
import {
  getGetKimeuOnboardingQueryKey, getGetKimeuPracticalsQueryKey, getGetKimeuTodayQueryKey,
  useGetKimeuOnboarding, useSaveKimeuOnboarding,
} from '@workspace/api-client-react';
import type { OnboardingInputResult, OnboardingPerson, OnboardingWorkspace } from '@workspace/api-client-react';
import { matchesParticipantSearch } from '@/lib/participant-search';

export type OnboardingCourseId = 'F-11' | 'F-12' | 'EN-CAD' | 'F-SURG-OBS';
export const isOnboardingCourse = (id: string): id is OnboardingCourseId => ['F-11', 'F-12', 'EN-CAD', 'F-SURG-OBS'].includes(id);

type Draft = { date: string; attended: boolean; result: OnboardingInputResult; notes: string; revision: string };
type Msg = { tone: 'success' | 'error'; text: string; conflict?: boolean };

function laToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function errorInfo(err: unknown) {
  const e = err as { status?: number; data?: { error?: string }; message?: string } | null;
  return { status: e?.status, message: e?.data?.error || e?.message || 'The save did not complete.' };
}
function fmtTime(s: string) {
  if (!s) return '';
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleString('en-US', { timeZone: 'America/Los_Angeles', dateStyle: 'medium', timeStyle: 'short' }) + ' PT';
}
const slug = (k: string) => k.replace(/[^a-zA-Z0-9_-]/g, '_');
const keyOf = (email: string, week: number) => `${email}|${week}`;
const asResult = (r: string): OnboardingInputResult => (r === 'Pass' || r === 'Fail' ? r : '');

function draftFrom(p: OnboardingPerson, week: number): Draft {
  const u = p.units.find((x) => x.week === week);
  return { date: u?.date ?? '', attended: u?.attended ?? false, result: asResult(u?.result ?? ''), notes: u?.notes ?? '', revision: p.revision };
}
function sameAsServer(d: Draft, p: OnboardingPerson, week: number) {
  const s = draftFrom(p, week);
  return d.date === s.date && d.attended === s.attended && d.result === s.result && d.notes === s.notes;
}

const COPY: Record<OnboardingCourseId, { title: string; lead: string; attend: string }> = {
  'F-11': { title: '1.1 Orientation', lead: 'Regional Director led. One orientation session per PT, recorded with attendance and a Pass/Fail sign-off.', attend: 'Attended orientation' },
  'F-12': { title: '1.2 Evaluation Retention', lead: 'Four distinct weekly one-hour workshops, each signed off by the Regional Director. Weeks must be recorded on different dates in chronological order.', attend: 'Full one-hour session delivered' },
  'EN-CAD': { title: 'Cadaver Lab', lead: 'The Regional Director confirms each PT’s attendance. No practical result or weekly sign-off is required.', attend: 'Attended Cadaver Lab' },
  'F-SURG-OBS': { title: 'Surgical Observation', lead: 'The Regional Director confirms each PT’s attendance. No practical result or weekly sign-off is required.', attend: 'Attended Surgical Observation' },
};

export function CourseOnboarding({ courseId }: { courseId: OnboardingCourseId }) {
  const attendanceOnly = courseId === 'EN-CAD' || courseId === 'F-SURG-OBS';
  const client = useQueryClient();
  const queryKey = getGetKimeuOnboardingQueryKey(courseId);
  const query = useGetKimeuOnboarding(courseId, { query: { queryKey, refetchInterval: 60_000, refetchOnWindowFocus: true } });
  const save = useSaveKimeuOnboarding();
  const data = query.data;
  const required = data?.requiredWeeks ?? (courseId === 'F-12' ? 4 : 1);
  const [search, setSearch] = useState('');
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [weekFor, setWeekFor] = useState<Record<string, number>>({});
  const [messages, setMessages] = useState<Record<string, Msg>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const dirtyCount = Object.keys(drafts).length;
  const copy = COPY[courseId];

  useEffect(() => {
    if (!dirtyCount) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    const guard = (event: MouseEvent) => {
      const a = (event.target as Element | null)?.closest('a[href]') as HTMLAnchorElement | null;
      if (!a || a.target === '_blank' || a.origin !== window.location.origin || a.pathname === window.location.pathname) return;
      if (!window.confirm('You have unsaved sign-off drafts. Leaving this page will discard them. Continue?')) { event.preventDefault(); event.stopImmediatePropagation(); }
    };
    window.addEventListener('beforeunload', h);
    document.addEventListener('click', guard, true);
    return () => { window.removeEventListener('beforeunload', h); document.removeEventListener('click', guard, true); };
  }, [dirtyCount]);

  const people = useMemo(() => {
    const list = data?.people ?? [];
    return list.filter((p) => matchesParticipantSearch(search, p.name, p.email, p.location));
  }, [data, search]);

  function update(p: OnboardingPerson, week: number, patch: Partial<Draft>) {
    const k = keyOf(p.email, week);
    setDrafts((all) => {
      const base = all[k] ?? draftFrom(p, week);
      const next = { ...base, ...patch };
      const copyAll = { ...all };
      if (sameAsServer(next, p, week) && next.revision === p.revision) delete copyAll[k]; else copyAll[k] = next;
      return copyAll;
    });
    setMessages((m) => { const c = { ...m }; delete c[p.email]; return c; });
  }

  function discard(p: OnboardingPerson, week: number) {
    if (!window.confirm('Discard this unsaved sign-off draft?')) return;
    setDrafts((all) => { const c = { ...all }; delete c[keyOf(p.email, week)]; return c; });
    setMessages((m) => { const c = { ...m }; delete c[p.email]; return c; });
  }

  function validate(d: Draft, p: OnboardingPerson, week: number): string | null {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date)) return 'Enter the session date.';
    if (d.date > laToday()) return 'The date cannot be in the future.';
    if (d.result === 'Fail' && !d.notes.trim()) return 'A Fail result requires notes.';
    if (d.result && !d.attended) return 'Mark attendance before recording Pass or Fail.';
    const others = p.units.filter((u) => u.week !== week && u.date);
    if (others.some((u) => u.date === d.date)) return 'Each week must be on a distinct date.';
    if (others.some((u) => (u.week < week && u.date > d.date) || (u.week > week && u.date < d.date))) return 'Weeks must be in chronological order.';
    return null;
  }

  function submit(p: OnboardingPerson, week: number) {
    const k = keyOf(p.email, week);
    const d = drafts[k];
    if (!d) return;
    const problem = validate(d, p, week);
    if (problem) { setMessages((m) => ({ ...m, [p.email]: { tone: 'error', text: problem } })); return; }
    setSavingKey(k);
    save.mutate({ courseId, data: { email: p.email, revision: d.revision, week, date: d.date, attended: d.attended, result: d.result, notes: d.notes.trim() } }, {
      onSuccess: (result: OnboardingWorkspace) => {
        client.setQueryData(queryKey, result);
        const trackingPrefix = `/api/kimeu/courses/${courseId}/tracking/`;
        client.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === 'string' && (q.queryKey[0] as string).startsWith(trackingPrefix) });
        client.invalidateQueries({ queryKey: getGetKimeuPracticalsQueryKey(courseId) });
        client.invalidateQueries({ queryKey: getGetKimeuTodayQueryKey() });
        setDrafts((all) => { const c = { ...all }; delete c[k]; return c; });
        const fresh = result.people.find((x) => x.email === p.email);
        const unit = fresh?.units.find((u) => u.week === week);
        const confirmed = unit && unit.date === d.date && unit.attended === d.attended && asResult(unit.result) === d.result;
        setMessages((m) => ({ ...m, [p.email]: confirmed
          ? { tone: 'success', text: `${attendanceOnly ? 'Attendance' : `Week ${week}`} saved and confirmed by the server${unit?.signedBy ? ` (signed by ${unit.signedBy})` : ''}.` }
          : { tone: 'error', text: `Save returned, but week ${week} did not read back as entered. Review the record below.` } }));
      },
      onError: (err) => {
        const { status, message } = errorInfo(err);
        setMessages((m) => ({ ...m, [p.email]: status === 409
          ? { tone: 'error', conflict: true, text: 'This person\'s record changed since you started. Your draft is kept. Reload to see the latest, then reapply.' }
          : { tone: 'error', text: `Not saved: ${message} Your draft is kept.` } }));
      },
      onSettled: () => setSavingKey(null),
    });
  }

  function rebase(p: OnboardingPerson, week: number) {
    query.refetch().then((r) => {
      const fresh = r.data?.people.find((x) => x.email === p.email);
      if (!fresh) return;
      setDrafts((all) => { const k = keyOf(p.email, week); return all[k] ? { ...all, [k]: { ...all[k], revision: fresh.revision } } : all; });
      setMessages((m) => ({ ...m, [p.email]: { tone: 'error', text: 'Latest record loaded. Your draft is kept on top of it; review and save again.' } }));
    });
  }

  const materials = [
    { icon: Presentation, title: 'Teaching slide deck', detail: 'The slide deck for this course has not been linked yet.' },
    { icon: FileText, title: 'PDF handout', detail: 'The separate handout PDF has not been linked yet.' },
    ...(courseId === 'F-12' ? [{ icon: ClipboardCheck, title: 'Weekly materials (optional)', detail: 'Optional per-week materials for weeks 1 to 4 have not been linked yet.' }] : []),
  ];

  return <section className="ct-root ob-root" aria-label={`${copy.title} sign-off`} data-testid="section-onboarding">
    <div className="section-title-row"><div><span className="section-kicker">{attendanceOnly ? 'REGIONAL DIRECTOR / ATTENDANCE ONLY' : `RD SIGN-OFF / ${required} ${required === 1 ? 'SESSION' : 'WEEKS'} REQUIRED`}</span><h2>{copy.title}</h2></div>
      <button type="button" className="button-quiet" onClick={() => query.refetch()} disabled={query.isFetching} data-testid="button-refresh-onboarding"><RefreshCw size={14} className={query.isFetching ? 'spin' : ''} /> Refresh</button></div>
    <p className="ct-explain">{copy.lead} {attendanceOnly ? 'Choose the attendance date, check the PT’s attendance, then Save attendance. Nothing saves automatically.' : 'Nothing saves automatically. Status and completed weeks are calculated from saved sign-offs; there is no separate completion approval.'}</p>
    <div className="ct-toolbar"><label className="ct-field ct-search"><span>Search active roster</span>
      <span className="ct-search-box"><Search size={14} /><input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, location or email" data-testid="input-search-onboarding" /></span></label></div>
    {dirtyCount > 0 && <p className="ct-meta"><span className="ct-unsaved" data-testid="text-onboarding-unsaved">{dirtyCount} unsaved</span> Drafts stay here until you save or discard them.</p>}
    {query.isLoading ? <div className="session-list" aria-label="Loading roster">{[0, 1, 2].map((i) => <div className="session-skeleton" key={i}><div className="skeleton skeleton-line w-40" /><div className="skeleton skeleton-line w-full" /></div>)}</div>
      : query.isError && !data ? <div className="state-card state-error" role="alert"><div className="state-icon"><CircleAlert size={18} /></div><div><h3>Roster could not load</h3><p>{errorInfo(query.error).message}</p><button type="button" className="button-quiet" onClick={() => query.refetch()} data-testid="button-retry-onboarding"><RefreshCw size={14} /> Try again</button></div></div>
      : !data?.people.length ? <div className="state-card"><div className="state-icon"><UserCheck size={18} /></div><div><h3>No active PTs</h3><p>The active roster returned no people for this course.</p></div></div>
      : <>
        {query.isError && <div className="inline-message inline-message-error">Latest refresh failed; showing last loaded records.</div>}
        {!data.canSignOff && <div className="ct-readonly" data-testid="status-onboarding-readonly"><Lock size={13} /> Read-only. Only Regional Directors can sign off this course.</div>}
        {!people.length && <p className="ct-meta" data-testid="text-onboarding-no-results">No PTs match "{search}".</p>}
        <ul className="ob-list">
          {people.map((p) => {
            const id = slug(p.email);
            const week = Math.min(weekFor[p.email] ?? Math.min(p.completedWeeks + 1, required), required);
            const k = keyOf(p.email, week);
            const d = drafts[k] ?? draftFrom(p, week);
            const dirty = k in drafts;
            const busy = savingKey === k;
            const msg = messages[p.email];
            const locked = !data.canSignOff || busy;
            return <li key={p.email} className={`ob-person${dirty ? ' ct-changed' : ''}`} data-testid={`row-onboarding-${id}`}>
              <div className="ob-head">
                <span className="ct-who"><strong data-testid={`text-onboarding-name-${id}`}>{p.name}</strong><small>{[p.location || 'No location', p.email].join(' / ')}</small></span>
                <span className="ob-status">{!attendanceOnly && <span className="count-chip" data-testid={`text-onboarding-weeks-${id}`}>{p.completedWeeks} / {required} {required === 1 ? 'session' : 'weeks'}</span>}<span className="ob-sheet" data-testid={`text-onboarding-status-${id}`}>{attendanceOnly ? (p.units[0]?.attended ? 'Attendance recorded' : 'Not recorded') : p.sheetStatus || 'No status yet'}</span></span>
              </div>
              {required > 1 && <div className="ob-weeks" role="tablist" aria-label="Week">
                {Array.from({ length: required }, (_, i) => i + 1).map((w) => {
                  const u = p.units.find((x) => x.week === w);
                  const has = keyOf(p.email, w) in drafts;
                  return <button key={w} type="button" role="tab" aria-selected={w === week} className={`ob-week${w === week ? ' ob-week-on' : ''}${u?.result === 'Pass' ? ' ob-week-pass' : u?.result === 'Fail' ? ' ob-week-fail' : ''}`} onClick={() => setWeekFor((s) => ({ ...s, [p.email]: w }))} data-testid={`button-week-${w}-${id}`}>Week {w}{u?.result ? ` / ${u.result}` : ''}{has ? ' *' : ''}</button>;
                })}
              </div>}
              <div className="ob-form">
                <label className="ct-field"><span>Session date</span><input type="date" max={laToday()} value={d.date} disabled={locked} onChange={(e) => update(p, week, { date: e.target.value })} data-testid={`input-date-${id}`} /></label>
                <label className="ct-check ob-attend"><input type="checkbox" checked={d.attended} disabled={locked} onChange={(e) => update(p, week, { attended: e.target.checked, ...(e.target.checked ? {} : { result: '' as OnboardingInputResult }) })} data-testid={`checkbox-attended-${id}`} /><span>{copy.attend}</span></label>
                {!attendanceOnly && <div className="ob-result" role="radiogroup" aria-label="Result">
                  {(['', 'Pass', 'Fail'] as OnboardingInputResult[]).map((r) => <label key={r || 'none'} className={`ob-pill${d.result === r ? ' ob-pill-on' : ''}`}><input type="radio" name={`result-${k}`} checked={d.result === r} disabled={locked || (!d.attended && r !== '')} onChange={() => update(p, week, { result: r })} data-testid={`radio-result-${r || 'none'}-${id}`} />{r || 'No result'}</label>)}
                </div>}
                {!attendanceOnly && <label className="ct-field ob-notes"><span>Notes{d.result === 'Fail' ? ' (required for Fail)' : ''}</span><textarea value={d.notes} maxLength={4000} disabled={locked} onChange={(e) => update(p, week, { notes: e.target.value })} data-testid={`input-notes-${id}`} /></label>}
              </div>
              {(() => { const u = p.units.find((x) => x.week === week); return u?.signedBy ? <p className="ct-meta" data-testid={`text-signed-${id}`}>Signed by {u.signedBy}{u.signedAt ? ` on ${fmtTime(u.signedAt)}` : ''}.</p> : null; })()}
              {msg && <div className={`inline-message inline-message-${msg.tone}`} role="status" data-testid={`status-onboarding-${id}`}>{msg.text}{msg.conflict && <button type="button" className="button-quiet ct-inline-btn" onClick={() => rebase(p, week)} data-testid={`button-reload-${id}`}>Reload latest</button>}</div>}
              {data.canSignOff && <div className="ct-actions">
                {dirty && <button type="button" className="button-quiet" onClick={() => discard(p, week)} disabled={busy} data-testid={`button-discard-${id}`}>Discard</button>}
                <button type="button" className="button-primary" onClick={() => submit(p, week)} disabled={!dirty || busy || save.isPending} data-testid={`button-save-${id}`}>{busy ? 'Saving...' : attendanceOnly ? 'Save attendance' : `Save week ${week}`}</button>
              </div>}
            </li>;
          })}
        </ul>
      </>}
    {!attendanceOnly && <div className="course-frames">
      {materials.map(({ icon: Icon, title, detail }) => <section key={title} className="course-frame" aria-label={title}>
        <div className="panel-heading"><div className="panel-icon"><Icon size={18} /></div><div><span className="section-kicker">NOT YET LINKED</span><h2>{title}</h2></div></div>
        <p>{detail}</p>
      </section>)}
    </div>}
  </section>;
}
