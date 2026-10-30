import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CircleAlert, ClipboardCheck, Lock, RefreshCw, Search, UserCheck } from 'lucide-react';
import {
  getGetKimeuBootstrapQueryKey, getGetKimeuFoundationsAssessmentQueryKey,
  useGetKimeuBootstrap, useGetKimeuFoundationsAssessment, useSaveKimeuFoundationsAssessment,
} from '@workspace/api-client-react';
import type { FoundationsAssessmentInputResult, FoundationsAssessmentPerson, FoundationsAssessmentWorkspace } from '@workspace/api-client-react';

type Msg = { tone: 'success' | 'error'; text: string };

export function canAssessFoundations(roles: string[] | undefined) {
  return (roles ?? []).some((r) => ['admin', 'rd', 'regional director'].includes(r.toLowerCase()));
}

function errorText(err: unknown) {
  const e = err as { status?: number; data?: { error?: string }; message?: string } | null;
  if (e?.status === 409) return 'This PT’s record changed since it was loaded. Refresh the roster, review the current result, then save again.';
  return e?.data?.error || e?.message || 'The save did not complete.';
}
const slug = (k: string) => k.replace(/[^a-zA-Z0-9_-]/g, '_');
const norm = (e: string) => e.trim().toLowerCase();

export function FoundationsAssessmentPage() {
  const { data: bootstrap } = useGetKimeuBootstrap({ query: { queryKey: getGetKimeuBootstrapQueryKey() } });
  const allowed = canAssessFoundations(bootstrap?.user?.roles);
  const client = useQueryClient();
  const queryKey = getGetKimeuFoundationsAssessmentQueryKey();
  const query = useGetKimeuFoundationsAssessment({ query: { queryKey, enabled: allowed, refetchInterval: 60_000, refetchOnWindowFocus: true } });
  const save = useSaveKimeuFoundationsAssessment();
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<FoundationsAssessmentInputResult | null>(null);
  const [draftRevision, setDraftRevision] = useState<string | null>(null);
  const [msg, setMsg] = useState<Msg | null>(null);
  const busy = save.isPending;
  const people = query.data?.people ?? [];
  const person = useMemo(() => people.find((p) => norm(p.email) === selected) ?? null, [people, selected]);
  const dirty = draft !== null && (!person || draft !== person.result);

  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    const guard = (event: MouseEvent) => {
      const a = (event.target as Element | null)?.closest('a[href]') as HTMLAnchorElement | null;
      if (!a || a.target === '_blank' || a.origin !== window.location.origin || a.pathname === window.location.pathname) return;
      if (!window.confirm('You have an unsaved Foundations Assessment result. Leaving this page will discard it. Continue?')) { event.preventDefault(); event.stopImmediatePropagation(); }
    };
    window.addEventListener('beforeunload', h);
    document.addEventListener('click', guard, true);
    return () => { window.removeEventListener('beforeunload', h); document.removeEventListener('click', guard, true); };
  }, [dirty]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? people.filter((p) => `${p.name} ${p.email} ${p.location}`.toLowerCase().includes(q)) : people;
  }, [people, search]);

  function choose(p: FoundationsAssessmentPerson) {
    if (busy || norm(p.email) === selected) return;
    if (dirty && !window.confirm('Discard the unsaved result for the current PT?')) return;
    setSelected(norm(p.email)); setDraft(null); setDraftRevision(null); setMsg(null);
  }

  function pick(r: FoundationsAssessmentInputResult) {
    if (!person || busy) return;
    setDraft(r); setMsg(null);
    // Pin the revision at the moment the draft starts so a background refetch cannot silently rebase it.
    if (draftRevision === null) setDraftRevision(person.revision);
  }

  function submit() {
    if (!person || !draft || busy) return;
    const email = person.email;
    const result = draft;
    save.mutate({ data: { email, result, revision: draftRevision ?? person.revision } }, {
      onSuccess: (ws: FoundationsAssessmentWorkspace) => {
        client.setQueryData(queryKey, ws);
        const fresh = ws.people.find((x) => norm(x.email) === norm(email));
        setDraft(null); setDraftRevision(null);
        setMsg(fresh?.result === result
          ? { tone: 'success', text: `${result} saved and read back from the Foundations Tracker.` }
          : { tone: 'error', text: 'Save returned, but the result did not read back as entered. Review the record before trying again.' });
      },
      onError: (err) => {
        const status = (err as { status?: number } | null)?.status;
        const definite = status !== undefined && status >= 400 && status < 500;
        setMsg({ tone: 'error', text: definite
          ? `Not saved: ${errorText(err)} Your selection and draft are kept; nothing was resubmitted.`
          : `Save not confirmed: ${errorText(err)} The sheet may or may not have been updated. Reload latest and check the current result before retrying. Your draft is kept; nothing was resubmitted.` });
      },
    });
  }

  function discard() {
    if (!window.confirm('Discard this unsaved result?')) return;
    setDraft(null); setDraftRevision(null); setMsg(null);
  }

  function reloadLatest() {
    query.refetch().then((r) => {
      if (r.isError || !r.data) { setMsg({ tone: 'error', text: 'Reload failed, so the latest record could not be confirmed. Your draft is kept; try Reload latest again before saving.' }); return; }
      const fresh = r.data?.people.find((x) => norm(x.email) === selected);
      if (!fresh) { setMsg({ tone: 'error', text: 'This PT is no longer in the returned roster. Do not save; review the roster.' }); return; }
      if (draft) { setDraftRevision(fresh.revision); setMsg({ tone: 'error', text: `Latest record loaded (current result: ${fresh.result || 'none'}). Your draft is kept; review and save again.` }); }
    });
  }

  const heading = <div className="page-heading"><div><div className="eyebrow">FOUNDATIONS / REGIONAL DIRECTOR</div><h1>Foundations Assessment</h1><p>Record each PT’s final Foundations Assessment result, one person at a time.</p></div>
    {allowed && <button type="button" className="button-quiet" onClick={() => query.refetch()} disabled={query.isFetching || busy} data-testid="button-refresh-fa"><RefreshCw size={16} className={query.isFetching ? 'spin' : ''} /> Refresh</button>}</div>;

  if (!bootstrap) return <div className="animate-rise">{heading}</div>;
  if (!allowed) return <div className="animate-rise">{heading}<div className="state-card" data-testid="status-fa-denied"><div className="state-icon"><Lock size={18} /></div><div><h3>Regional Directors only</h3><p>Foundations Assessment results can only be viewed and recorded by Regional Directors and administrators.</p></div></div></div>;

  return <div className="animate-rise fa-root">
    {heading}
    <p className="ct-explain" data-testid="text-fa-explain">Saving writes Pass or Fail to the <b>Exam Result</b> column (H) of <b>03c-Foundations Tracker</b> for the PT matched by email. The Clinician Development Tool reads that column on its next refresh; this page does not edit the tool, approve the overall pathway, or change Kajabi. Nothing saves automatically.</p>
    {query.isLoading ? <div className="session-list" aria-label="Loading roster">{[0, 1, 2].map((i) => <div className="session-skeleton" key={i}><div className="skeleton skeleton-line w-40" /><div className="skeleton skeleton-line w-full" /></div>)}</div>
      : query.isError && !query.data ? <div className="state-card state-error" role="alert"><div className="state-icon"><CircleAlert size={18} /></div><div><h3>Roster could not load</h3><p>{errorText(query.error)}</p><button type="button" className="button-quiet" onClick={() => query.refetch()} data-testid="button-retry-fa"><RefreshCw size={14} /> Try again</button></div></div>
      : !people.length ? <div className="state-card"><div className="state-icon"><UserCheck size={18} /></div><div><h3>No PTs to assess</h3><p>This list only includes active roster PTs who already have a row in 03c-Foundations Tracker and are assigned to you as RD. PTs without a tracker row do not appear here.</p></div></div>
      : <div className="fa-grid">
        <section className="fa-roster" aria-label="Foundations roster">
          {query.isError && <div className="inline-message inline-message-error">Latest refresh failed; showing last loaded records.</div>}
          <label className="ct-field ct-search"><span>Search roster</span><span className="ct-search-box"><Search size={14} /><input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, email or location" data-testid="input-search-fa" /></span></label>
          <p className="ct-meta">{filtered.length} of {people.length} PTs</p>
          {!filtered.length ? <p className="ct-meta" data-testid="text-fa-no-results">No PTs match "{search}".</p>
            : <ul className="fa-list" role="listbox" aria-label="Choose a PT">
              {filtered.map((p) => { const on = norm(p.email) === selected; const id = slug(p.email); return <li key={p.email}>
                <button type="button" role="option" aria-selected={on} className={`fa-row${on ? ' fa-row-on' : ''}`} onClick={() => choose(p)} disabled={busy && !on} data-testid={`button-select-fa-${id}`}>
                  <span className="ct-who"><strong>{p.name || p.email}</strong><small>{[p.location || 'No location', p.email].join(' / ')}</small></span>
                  <ResultTag result={p.result} />
                </button></li>; })}
            </ul>}
        </section>
        <section className="fa-panel" aria-label="Record result" data-testid="panel-fa">
          {!person ? <div className="state-card"><div className="state-icon"><ClipboardCheck size={18} /></div><div><h3>Select a PT</h3><p>Choose someone from the roster. No one is selected by default, so a result is never recorded against the wrong person.</p></div></div>
            : <>
              <span className="section-kicker">SELECTED PT</span>
              <h2 data-testid="text-fa-name">{person.name || person.email}</h2>
              <p className="fa-email" data-testid="text-fa-email">{person.email}</p>
              <p className="ct-meta">{person.location || 'No location'}</p>
              <div className="fa-current">Current result in sheet <ResultTag result={person.result} /></div>
              <div className="ob-result" role="radiogroup" aria-label="New result">
                {(['Pass', 'Fail'] as FoundationsAssessmentInputResult[]).map((r) => <label key={r} className={`ob-pill${draft === r ? ' ob-pill-on' : ''}`}><input type="radio" name="fa-result" checked={draft === r} disabled={busy} onChange={() => pick(r)} data-testid={`radio-fa-${r.toLowerCase()}`} />{r}</label>)}
              </div>
              {dirty && <p className="ct-meta"><span className="ct-unsaved" data-testid="text-fa-unsaved">Unsaved</span> Will record <b>{draft}</b> for {person.email}.</p>}
              {msg && <div className={`inline-message inline-message-${msg.tone}`} role={msg.tone === 'error' ? 'alert' : 'status'} data-testid="status-fa-save">{msg.text}{msg.tone === 'error' && dirty && <button type="button" className="button-quiet ct-inline-btn" onClick={reloadLatest} disabled={query.isFetching} data-testid="button-fa-reload">Reload latest</button>}</div>}
              <div className="ct-actions">
                {dirty && <button type="button" className="button-quiet" onClick={discard} disabled={busy} data-testid="button-fa-discard">Discard</button>}
                <button type="button" className="button-primary" onClick={submit} disabled={!dirty || busy} data-testid="button-fa-save">{busy ? 'Saving...' : draft ? `Save ${draft}` : 'Save result'}</button>
              </div>
            </>}
        </section>
      </div>}
  </div>;
}

function ResultTag({ result }: { result: string }) {
  const r = result.trim();
  return <span className={`fa-tag${r === 'Pass' ? ' fa-tag-pass' : r === 'Fail' ? ' fa-tag-fail' : ''}`}>{r || 'No result'}</span>;
}
