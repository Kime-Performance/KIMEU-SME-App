import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CircleAlert, GraduationCap, History, Lock, RefreshCw, Search, UserCheck } from 'lucide-react';
import { getGetKimeuFellowshipReviewsQueryKey, useGetKimeuFellowshipReviews, useSaveKimeuFellowshipReview } from '@workspace/api-client-react';
import type { FellowshipReviewEntry, FellowshipReviewInput, FellowshipReviewPerson, FellowshipReviewWorkspace } from '@workspace/api-client-react';
import './fellowship-reviews.css';

type Result = '' | 'Pass' | 'Refocus';
type Draft = { reviewDate: string; result: Result; score: string; notes: string; workshopId: string };
type Msg = { tone: 'success' | 'error'; text: string; conflict?: boolean };
const EMPTY = (today: string): Draft => ({ reviewDate: today, result: '', score: '', notes: '', workshopId: '' });

function errorInfo(err: unknown) {
  const e = err as { status?: number; data?: { error?: string }; message?: string } | null;
  return { status: e?.status, message: e?.data?.error || e?.message || 'The request did not complete.' };
}
function fmtTime(s: string) {
  // Sheet timestamps are already Pacific wall-clock values, not UTC instants.
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?$/.test(s)) return s.replace('T', ' ') + ' PT';
  const d = new Date(s);
  return !s || Number.isNaN(d.getTime()) ? s : d.toLocaleString('en-US', { timeZone: 'America/Los_Angeles', dateStyle: 'medium', timeStyle: 'short' }) + ' PT';
}
const slug = (k: string) => k.replace(/[^a-zA-Z0-9_-]/g, '_');
const label = (r: string) => (r === 'Refocus' ? 'Fail / Refocus' : r || 'No result');
const tone = (r: string) => (r === 'Pass' ? 'pass' : r === 'Refocus' ? 'refocus' : 'none');
function uuid() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = (Math.random() * 16) | 0; return (c === 'x' ? r : (r & 3) | 8).toString(16); });
}

function validate(d: Draft, today: string): Record<string, string> {
  const e: Record<string, string> = {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.reviewDate)) e.reviewDate = 'Enter the review date.';
  else if (d.reviewDate > today) e.reviewDate = 'The review date cannot be in the future.';
  if (!d.result) e.result = 'Choose Pass or Fail / Refocus.';
  const n = Number(d.score);
  if (d.score.trim() === '' || !Number.isFinite(n) || n < 0 || n > 100) e.score = 'Enter an overall score from 0 to 100.';
  if (d.result === 'Refocus' && d.notes.trim().length < 5) e.notes = 'Fail / Refocus requires clinical feedback notes (at least 5 characters).';
  if (d.notes.length > 4000) e.notes = 'Notes are limited to 4000 characters.';
  return e;
}

export function FellowshipReviewsPage() {
  const client = useQueryClient();
  const queryKey = getGetKimeuFellowshipReviewsQueryKey();
  const query = useGetKimeuFellowshipReviews({ query: { queryKey, staleTime: 30_000, refetchInterval: 60_000, refetchOnWindowFocus: true, retry: (n, err) => errorInfo(err).status !== 403 && n < 2 } });
  const save = useSaveKimeuFellowshipReview();
  const data = query.data;
  const today = data?.today ?? '';
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [revisions, setRevisions] = useState<Record<string, string>>({});
  const [messages, setMessages] = useState<Record<string, Msg>>({});
  const [showErrors, setShowErrors] = useState<Record<string, boolean>>({});
  const [savingEmail, setSavingEmail] = useState<string | null>(null);
  const pending = useRef<Record<string, { payload: string; requestId: string }>>({});
  const dirtyCount = Object.keys(drafts).length;

  useEffect(() => {
    if (!dirtyCount) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    const guard = (event: MouseEvent) => {
      const a = (event.target as Element | null)?.closest('a[href]') as HTMLAnchorElement | null;
      if (!a || a.target === '_blank' || a.origin !== window.location.origin || a.pathname === window.location.pathname) return;
      if (!window.confirm('You have unsaved Fellowship review drafts. Leaving will discard them. Continue?')) { event.preventDefault(); event.stopImmediatePropagation(); }
    };
    window.addEventListener('beforeunload', h);
    document.addEventListener('click', guard, true);
    return () => { window.removeEventListener('beforeunload', h); document.removeEventListener('click', guard, true); };
  }, [dirtyCount]);

  const byEmail = useMemo(() => {
    const m = new Map<string, FellowshipReviewEntry[]>();
    for (const r of data?.reviews ?? []) { const k = r.email.toLowerCase(); m.set(k, [...(m.get(k) ?? []), r]); }
    for (const list of m.values()) list.sort((a, b) => (b.reviewDate + b.updatedAt).localeCompare(a.reviewDate + a.updatedAt));
    return m;
  }, [data]);
  const people = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = data?.people ?? [];
    return q ? list.filter((p) => `${p.name} ${p.location} ${p.email}`.toLowerCase().includes(q)) : list;
  }, [data, search]);
  const person = data?.people.find((p) => p.email === selected) ?? null;
  const workshopName = (id: string | null) => (id ? data?.workshops.find((w) => w.workshopId === id)?.name ?? id : '');

  // Revision baseline: pinned while a draft exists, otherwise tracks server.
  const revisionFor = (p: FellowshipReviewPerson) => (drafts[p.email] && revisions[p.email]) || p.revision;

  function update(p: FellowshipReviewPerson, patch: Partial<Draft>) {
    setDrafts((all) => ({ ...all, [p.email]: { ...(all[p.email] ?? EMPTY(today)), ...patch } }));
    setRevisions((r) => (r[p.email] && drafts[p.email] ? r : { ...r, [p.email]: p.revision }));
    setMessages((m) => { const c = { ...m }; delete c[p.email]; return c; });
  }
  function discard(email: string) {
    if (!window.confirm('Discard this unsaved review draft?')) return;
    setDrafts((a) => { const c = { ...a }; delete c[email]; return c; });
    setShowErrors((s) => ({ ...s, [email]: false }));
    setMessages((m) => { const c = { ...m }; delete c[email]; return c; });
    delete pending.current[email];
  }

  function submit(p: FellowshipReviewPerson) {
    const d = drafts[p.email];
    if (!d) return;
    const errs = validate(d, today);
    if (Object.keys(errs).length) { setShowErrors((s) => ({ ...s, [p.email]: true })); setMessages((m) => ({ ...m, [p.email]: { tone: 'error', text: 'Fix the highlighted fields before saving.' } })); return; }
    const body = { email: p.email, reviewDate: d.reviewDate, result: d.result as 'Pass' | 'Refocus', score: Number(d.score), notes: d.notes.trim(), workshopId: d.workshopId || null, revision: revisionFor(p) };
    const payload = JSON.stringify(body);
    const prior = pending.current[p.email];
    const requestId = prior && prior.payload === payload ? prior.requestId : uuid();
    pending.current[p.email] = { payload, requestId };
    const input: FellowshipReviewInput = { ...body, requestId };
    setSavingEmail(p.email);
    setMessages((m) => ({ ...m, [p.email]: { tone: 'success', text: 'Saving and verifying against the sheet...' } }));
    save.mutate({ data: input }, {
      onSuccess: (ws: FellowshipReviewWorkspace) => {
        void client.cancelQueries({ queryKey });
        client.setQueryData(queryKey, ws);
        delete pending.current[p.email];
        const fresh = ws.people.find((x) => x.email === p.email);
        setDrafts((a) => { const c = { ...a }; delete c[p.email]; return c; });
        setRevisions((r) => ({ ...r, [p.email]: fresh?.revision ?? r[p.email] }));
        setShowErrors((s) => ({ ...s, [p.email]: false }));
        setMessages((m) => ({ ...m, [p.email]: { tone: 'success', text: `Saved and read back: ${label(input.result)}, score ${input.score}, dated ${input.reviewDate}. Added as a new attempt.` } }));
      },
      onError: (err) => {
        const { status, message } = errorInfo(err);
        setMessages((m) => ({ ...m, [p.email]: status === 409
          ? { tone: 'error', conflict: true, text: 'This clinician\'s record changed since you started. Your draft is kept. Load the latest record, review it, then save again.' }
          : status === 403 ? { tone: 'error', text: 'You no longer have permission to record Fellowship reviews. Your draft is kept.' }
          : { tone: 'error', text: `Save not confirmed: ${message} Your draft is kept; saving again retries the same attempt.` } }));
      },
      onSettled: () => setSavingEmail(null),
    });
  }

  function rebase(p: FellowshipReviewPerson) {
    query.refetch().then((r) => {
      if (r.isError) {
        setMessages((m) => ({ ...m, [p.email]: { tone: 'error', conflict: true, text: 'The latest record could not be loaded. Your draft is kept. Try loading again before saving.' } }));
        return;
      }
      const fresh = r.data?.people.find((x) => x.email === p.email);
      if (!fresh) { setMessages((m) => ({ ...m, [p.email]: { tone: 'error', text: 'This clinician is no longer on the active roster.' } })); return; }
      setRevisions((rv) => ({ ...rv, [p.email]: fresh.revision }));
      delete pending.current[p.email];
      setMessages((m) => ({ ...m, [p.email]: { tone: 'error', text: 'Latest record loaded. Check the history below; your draft is kept. Save again to append it.' } }));
    });
  }

  const forbidden = query.isError && errorInfo(query.error).status === 403;
  const heading = <div className="page-heading"><div><div className="eyebrow">FELLOWSHIP / OVERALL EXAM</div><h1>Fellowship Reviews</h1><p>Record a clinician's overall Fellowship Exam outcome. Every save appends a new attempt; earlier attempts and feedback are never edited or removed.</p></div>
    <button type="button" className="button-quiet" onClick={() => query.refetch()} disabled={query.isFetching} data-testid="button-refresh-fellowship"><RefreshCw size={16} className={query.isFetching ? 'spin' : ''} /> Refresh</button></div>;

  if (forbidden) return <div className="animate-rise">{heading}<div className="state-card state-error" role="alert" data-testid="status-fellowship-forbidden"><div className="state-icon"><Lock size={18} /></div><div><h3>Access restricted</h3><p>Fellowship reviews are available only to approved Fellowship Reviewers and administrators. No records are shown.</p></div></div></div>;
  if (query.isLoading) return <div className="animate-rise">{heading}<div className="session-list" aria-label="Loading reviews">{[0, 1, 2].map((i) => <div className="session-skeleton" key={i}><div className="skeleton skeleton-line w-40" /><div className="skeleton skeleton-line w-full" /></div>)}</div></div>;
  if (query.isError && !data) return <div className="animate-rise">{heading}<div className="state-card state-error" role="alert"><div className="state-icon"><CircleAlert size={18} /></div><div><h3>Fellowship reviews could not load</h3><p>{errorInfo(query.error).message}</p><button type="button" className="button-quiet" onClick={() => query.refetch()} data-testid="button-retry-fellowship"><RefreshCw size={14} /> Try again</button></div></div></div>;
  if (!data?.people.length) return <div className="animate-rise">{heading}<div className="state-card" data-testid="status-fellowship-empty"><div className="state-icon"><UserCheck size={18} /></div><div><h3>No clinicians to review</h3><p>The active roster returned no clinicians eligible for a Fellowship review.</p></div></div></div>;

  const d = person ? drafts[person.email] ?? EMPTY(today) : null;
  const dirty = !!(person && drafts[person.email]);
  const errs = person && d && showErrors[person.email] ? validate(d, today) : {};
  const busy = !!person && savingEmail === person.email;
  const msg = person ? messages[person.email] : undefined;
  const history = person ? byEmail.get(person.email.toLowerCase()) ?? [] : [];
  const id = person ? slug(person.email) : '';

  return <div className="animate-rise">
    {heading}
    {query.isError && <div className="inline-message inline-message-error">Latest refresh failed; showing the last loaded records.</div>}
    {dirtyCount > 0 && <p className="ct-meta"><span className="ct-unsaved" data-testid="text-fellowship-unsaved">{dirtyCount} unsaved</span> Drafts stay here until you save or discard them.</p>}
    <div className="fr-layout">
      <aside className="fr-people" aria-label="Clinicians">
        <label className="ct-field ct-search"><span>Find clinician</span>
          <span className="ct-search-box"><Search size={14} /><input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, location or email" data-testid="input-search-fellowship" /></span></label>
        {!people.length ? <p className="ct-meta" data-testid="text-fellowship-no-results">No clinicians match "{search}".</p> : <ul>
          {people.map((p) => {
            const latest = byEmail.get(p.email.toLowerCase())?.[0];
            return <li key={p.email}><button type="button" className={`fr-person${p.email === selected ? ' fr-person-on' : ''}`} onClick={() => setSelected(p.email)} data-testid={`button-select-${slug(p.email)}`}>
              <span><strong>{p.name}{drafts[p.email] ? ' *' : ''}</strong><small>{p.location || 'No location'}</small></span>
              <span className={`fr-tag fr-tag-${tone(latest?.result ?? '')}`}>{latest ? label(latest.result) : 'Not reviewed'}</span>
            </button></li>;
          })}
        </ul>}
      </aside>
      <div className="fr-main">
        {!person || !d ? <div className="state-card"><div className="state-icon"><GraduationCap size={18} /></div><div><h3>Choose a clinician</h3><p>Select a clinician to record an overall Fellowship Exam result and see every earlier attempt.</p></div></div> : <>
          <section className={`fr-card${dirty ? ' fr-card-dirty' : ''}`} data-testid="form-fellowship-review">
            <div className="panel-heading"><div className="panel-icon"><GraduationCap size={18} /></div><div><span className="section-kicker">NEW ATTEMPT / FELLOWSHIP EXAM</span><h2 data-testid="text-fellowship-name">{person.name}</h2></div></div>
            <p className="ct-meta">{[person.location || 'No location', person.email].join(' / ')}. There is no automatic pass threshold; the result is your decision.</p>
            <div className="fr-form">
              <div className="fr-row">
                <label className="ct-field"><span>Review date</span><input type="date" max={today} value={d.reviewDate} disabled={busy} onChange={(e) => update(person, { reviewDate: e.target.value })} data-testid="input-review-date" />{errs.reviewDate && <span className="fr-err">{errs.reviewDate}</span>}</label>
                <label className="ct-field"><span>Overall score (0 to 100)</span><input type="number" inputMode="decimal" min={0} max={100} step="any" value={d.score} disabled={busy} onChange={(e) => update(person, { score: e.target.value })} data-testid="input-review-score" />{errs.score && <span className="fr-err">{errs.score}</span>}</label>
              </div>
              <div className="ct-field"><span>Result</span>
                <div className="fr-results" role="radiogroup" aria-label="Result">
                  {(['Pass', 'Refocus'] as const).map((r) => <label key={r} className={`fr-choice fr-choice-${tone(r)}${d.result === r ? ' fr-choice-on' : ''}`}><input type="radio" name={`fr-result-${id}`} checked={d.result === r} disabled={busy} onChange={() => update(person, { result: r, ...(r === 'Pass' ? { workshopId: '' } : {}) })} data-testid={`radio-result-${r.toLowerCase()}`} />{label(r)}</label>)}
                </div>{errs.result && <span className="fr-err">{errs.result}</span>}</div>
              <label className="ct-field"><span>Specific refocus area <span className="fr-hint">(optional; leave blank for an overall review)</span></span>
                <select value={d.workshopId} disabled={busy || d.result !== 'Refocus'} onChange={(e) => update(person, { workshopId: e.target.value })} data-testid="select-review-workshop">
                  <option value="">No specific workshop</option>
                  {data.workshops.map((w) => <option key={w.workshopId} value={w.workshopId}>{w.workshopId} / {w.name}</option>)}
                </select></label>
              <label className="ct-field"><span>Clinical feedback{d.result === 'Refocus' ? ' (required for Fail / Refocus)' : ''} <span className="fr-hint">{d.notes.length} / 4000</span></span>
                <textarea maxLength={4000} value={d.notes} disabled={busy} onChange={(e) => update(person, { notes: e.target.value })} placeholder="What the clinician demonstrated, and what to focus on next." data-testid="input-review-notes" />{errs.notes && <span className="fr-err">{errs.notes}</span>}</label>
            </div>
            {msg && <div className={`inline-message inline-message-${msg.tone}`} style={{ marginTop: 14 }} role="status" data-testid="status-fellowship-save">{msg.text}{msg.conflict && <button type="button" className="button-quiet ct-inline-btn" onClick={() => rebase(person)} disabled={query.isFetching} data-testid="button-reload-fellowship">Load latest</button>}</div>}
            <div className="ct-actions">
              {dirty && <button type="button" className="button-quiet" onClick={() => discard(person.email)} disabled={busy} data-testid="button-discard-fellowship">Discard</button>}
              <button type="button" className="button-primary" onClick={() => submit(person)} disabled={!dirty || busy || save.isPending} data-testid="button-save-fellowship">{busy ? 'Saving...' : 'Record attempt'}</button>
            </div>
          </section>
          <section className="fr-card" data-testid="list-fellowship-history">
            <div className="section-title-row"><div><span className="section-kicker">PRIOR ATTEMPTS</span><h2>Review history</h2></div><span className="count-chip">{history.length} {history.length === 1 ? 'attempt' : 'attempts'}</span></div>
            {!history.length ? <div className="state-card"><div className="state-icon"><History size={18} /></div><div><h3>No Fellowship reviews yet</h3><p>This will be the clinician's first recorded attempt.</p></div></div>
              : <ol className="fr-history">{history.map((r) => <li key={r.id} className={`fr-attempt fr-attempt-${tone(r.result)}`} data-testid={`row-review-${slug(r.id)}`}>
                <div className="fr-attempt-head">
                  <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}><span className="fr-score" data-testid={`text-review-score-${slug(r.id)}`}>{r.score ?? '--'}</span><span className={`fr-tag fr-tag-${tone(r.result)}`} data-testid={`text-review-result-${slug(r.id)}`}>{label(r.result)}</span>{r.status && <span className="status-tag">{r.status}</span>}</span>
                  <small>{r.reviewDate} / {r.reviewType || 'Fellowship Exam'}</small>
                </div>
                {(r.workshopId || r.specificNeed) && <small style={{ display: 'block', marginTop: 6 }}>Refocus area: {r.workshopId ? `${r.workshopId} / ${workshopName(r.workshopId)}` : r.specificNeed}</small>}
                {r.notes ? <p>{r.notes}</p> : <p style={{ color: '#9a9e95' }}>No notes recorded.</p>}
                <small style={{ display: 'block', marginTop: 8 }}>Reviewed by {r.reviewedBy || 'unknown'}{r.updatedAt ? ` / recorded ${fmtTime(r.updatedAt)}` : ''}</small>
              </li>)}</ol>}
          </section>
        </>}
      </div>
    </div>
  </div>;
}
