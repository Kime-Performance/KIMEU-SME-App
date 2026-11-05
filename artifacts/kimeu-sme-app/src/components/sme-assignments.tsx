import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CircleAlert, RefreshCw, Search, UsersRound } from 'lucide-react';
import {
  getGetKimeuBootstrapQueryKey, getGetKimeuCoursesQueryKey, getGetKimeuSmeAssignmentsQueryKey,
  useGetKimeuSmeAssignments, useSaveKimeuSmeAssignment,
} from '@workspace/api-client-react';
import type { SmeAssignmentInputSmeRolesItem, SmeAssignmentStaff, SmeAssignments } from '@workspace/api-client-react';

type Role = SmeAssignmentInputSmeRolesItem;
const ROLES: { role: Role; stage: string; label: string }[] = [
  { role: 'SME Assist', stage: 'foundations', label: 'Foundations' },
  { role: 'SME Lead', stage: 'fellowship', label: 'Fellowship' },
];
type Draft = { roles: Role[]; workshopIds: string[]; revision: string };

function errorInfo(err: unknown) {
  const e = err as { status?: number; data?: { error?: string }; message?: string } | null;
  return { status: e?.status, message: e?.data?.error || e?.message || 'The save did not complete.' };
}
const slug = (k: string) => k.replace(/[^a-zA-Z0-9_-]/g, '_');
const smeRoles = (s: SmeAssignmentStaff) => ROLES.map((r) => r.role).filter((r) => s.roles.includes(r));
const RD_LED = new Set(['F-11', 'F-12', 'EN-CAD', 'F-SURG-OBS']);
const isRdOrAdmin = (s: SmeAssignmentStaff) => s.roles.some((r) => /^(admin|rd|regional director)$/i.test(r.trim()));
const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

export function SmeAssignmentsPanel() {
  const client = useQueryClient();
  const queryKey = getGetKimeuSmeAssignmentsQueryKey();
  const query = useGetKimeuSmeAssignments({ query: { queryKey, refetchInterval: 60_000, refetchOnWindowFocus: true } });
  const save = useSaveKimeuSmeAssignment();
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [messages, setMessages] = useState<Record<string, { tone: 'success' | 'error'; text: string; conflict?: boolean }>>({});
  const data = query.data;

  const stageOf = useMemo(() => new Map((data?.courses ?? []).map((c) => [c.workshopId, c.stage.trim().toLowerCase()])), [data]);
  const staff = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = (data?.staff ?? []).filter((s) => s.active);
    return q ? list.filter((s) => `${s.name} ${s.email} ${s.roles.join(' ')}`.toLowerCase().includes(q)) : list;
  }, [data, search]);

  const isSmeCourse = (id: string) => !RD_LED.has(id) && ROLES.some((r) => r.stage === stageOf.get(id));
  const draftFor = (s: SmeAssignmentStaff): Draft => drafts[s.email] ?? { roles: smeRoles(s), workshopIds: s.workshopIds.filter(isSmeCourse), revision: data?.revision ?? '' };

  function setDraft(s: SmeAssignmentStaff, next: Draft) {
    const base = { roles: smeRoles(s), ids: s.workshopIds.filter(isSmeCourse) };
    setDrafts((all) => { const c = { ...all }; if (sameSet(next.roles, base.roles) && sameSet(next.workshopIds, base.ids)) delete c[s.email]; else c[s.email] = next; return c; });
    setMessages((m) => { const c = { ...m }; delete c[s.email]; return c; });
  }
  function toggleRole(s: SmeAssignmentStaff, role: Role, on: boolean) {
    const d = draftFor(s);
    const roles = on ? [...d.roles, role] : d.roles.filter((r) => r !== role);
    const allowed = ROLES.filter((r) => roles.includes(r.role)).map((r) => r.stage);
    setDraft(s, { ...d, roles, workshopIds: isRdOrAdmin(s) ? d.workshopIds : d.workshopIds.filter((id) => allowed.includes(stageOf.get(id) ?? '')) });
  }
  function toggleCourse(s: SmeAssignmentStaff, id: string, on: boolean) {
    const d = draftFor(s);
    setDraft(s, { ...d, workshopIds: on ? [...d.workshopIds, id] : d.workshopIds.filter((x) => x !== id) });
  }
  function submit(s: SmeAssignmentStaff) {
    const d = drafts[s.email];
    if (!d) return;
    const retained = s.workshopIds.filter((id) => !isSmeCourse(id));
    const workshopIds = [...retained, ...d.workshopIds];
    save.mutate({ data: { email: s.email, revision: d.revision, smeRoles: d.roles, workshopIds } }, {
      onSuccess: (result: SmeAssignments) => {
        client.setQueryData(queryKey, result);
        client.invalidateQueries({ queryKey: getGetKimeuBootstrapQueryKey() });
        client.invalidateQueries({ queryKey: getGetKimeuCoursesQueryKey() });
        setDrafts((all) => { const c = { ...all }; delete c[s.email]; return c; });
        const fresh = result.staff.find((x) => x.email === s.email);
        const ok = fresh && sameSet(smeRoles(fresh), d.roles) && sameSet(fresh.workshopIds, workshopIds);
        setMessages((m) => ({ ...m, [s.email]: ok ? { tone: 'success', text: 'Saved and confirmed by the server.' } : { tone: 'error', text: 'Save returned, but the stored record does not match what was entered. Review below.' } }));
      },
      onError: (err) => {
        const { status, message } = errorInfo(err);
        setMessages((m) => ({ ...m, [s.email]: status === 409 ? { tone: 'error', conflict: true, text: 'Staff assignments changed since you started. Your draft is kept.' } : { tone: 'error', text: `Not saved: ${message} Your draft is kept.` } }));
      },
    });
  }
  function reload(s: SmeAssignmentStaff) {
    query.refetch().then((r) => {
      if (!r.data) return;
      const rev = r.data.revision;
      setDrafts((all) => all[s.email] ? { ...all, [s.email]: { ...all[s.email], revision: rev } } : all);
      setMessages((m) => ({ ...m, [s.email]: { tone: 'error', text: 'Latest assignments loaded. Review your draft and save again.' } }));
    });
  }

  return <section className="settings-card" data-testid="section-sme-assignments">
    <div className="settings-card-head"><div className="panel-icon"><UsersRound size={19} /></div><div><span className="section-kicker">ADMIN / STAFF</span><h2>SME roles and workshops</h2></div>
      <button type="button" className="button-quiet" onClick={() => query.refetch()} disabled={query.isFetching} data-testid="button-refresh-sme"><RefreshCw size={14} className={query.isFetching ? 'spin' : ''} /> Refresh</button></div>
    <p className="ct-explain">Approved SMEs can browse every workshop. Assign SME Assist to lead Foundations or SME Lead to lead Fellowship; individual workshop assignments control attendance editing. Orientation, Evaluation Retention, Cadaver Lab and Surgical Observation are RD-led and not assigned here. Admin, Regional Director and activation status are kept as they are, along with existing RD/Admin workshop assignments.</p>
    <label className="ct-field ct-search"><span>Search approved staff</span><span className="ct-search-box"><Search size={14} /><input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, email or role" data-testid="input-search-staff" /></span></label>
    {query.isLoading ? <div className="session-list">{[0, 1].map((i) => <div className="session-skeleton" key={i}><div className="skeleton skeleton-line w-40" /><div className="skeleton skeleton-line w-56" /></div>)}</div>
      : query.isError && !data ? <div className="state-card state-error" role="alert"><div className="state-icon"><CircleAlert size={18} /></div><div><h3>Staff could not load</h3><p>{errorInfo(query.error).message}</p><button type="button" className="button-quiet" onClick={() => query.refetch()} data-testid="button-retry-sme"><RefreshCw size={14} /> Try again</button></div></div>
      : !staff.length ? <p className="ct-meta" data-testid="text-sme-empty">{search ? `No staff match "${search}".` : 'No active approved staff returned.'}</p>
      : <ul className="ob-list">
        {query.isError && <li className="inline-message inline-message-error">Latest refresh failed; showing last loaded staff.</li>}
        {staff.map((s) => {
          const id = slug(s.email);
          const d = draftFor(s);
          const dirty = s.email in drafts;
          const msg = messages[s.email];
          const expanded = open === s.email || dirty;
          const other = s.roles.filter((r) => !ROLES.some((x) => x.role === r));
          return <li key={s.email} className={`ob-person${dirty ? ' ct-changed' : ''}`} data-testid={`row-staff-${id}`}>
            <div className="ob-head"><span className="ct-who"><strong>{s.name || s.email}</strong><small>{s.email}{other.length ? ` / ${other.join(', ')}` : ''}</small></span>
              <span className="ob-status">{smeRoles(s).map((r) => <span key={r} className="count-chip">{r}</span>)}<button type="button" className="button-quiet" onClick={() => setOpen(expanded && !dirty ? null : s.email)} data-testid={`button-edit-staff-${id}`}>{expanded ? 'Close' : 'Edit'}</button></span></div>
            {expanded && <>
              {ROLES.map((r) => {
                const on = d.roles.includes(r.role);
                const courses = (data?.courses ?? []).filter((c) => c.stage.trim().toLowerCase() === r.stage && !RD_LED.has(c.workshopId));
                return <div key={r.role} className="ob-form">
                  <label className="ct-check ob-attend"><input type="checkbox" checked={on} disabled={save.isPending} onChange={(e) => toggleRole(s, r.role, e.target.checked)} data-testid={`checkbox-role-${slug(r.role)}-${id}`} /><span><b>{r.role}</b> / leads {r.label}</span></label>
                  {on && <div className="ob-courses">{courses.length ? courses.map((c) => <label key={c.workshopId} className={`ob-pill${d.workshopIds.includes(c.workshopId) ? ' ob-pill-on' : ''}`}><input type="checkbox" checked={d.workshopIds.includes(c.workshopId)} disabled={save.isPending} onChange={(e) => toggleCourse(s, c.workshopId, e.target.checked)} data-testid={`checkbox-course-${slug(c.workshopId)}-${id}`} />{c.workshopId} {c.name}</label>) : <span className="ct-meta">No {r.label} courses in the catalog.</span>}</div>}
                </div>;
              })}
              {msg && <div className={`inline-message inline-message-${msg.tone}`} role="status" data-testid={`status-staff-${id}`}>{msg.text}{msg.conflict && <button type="button" className="button-quiet ct-inline-btn" onClick={() => reload(s)} data-testid={`button-reload-staff-${id}`}>Reload latest</button>}</div>}
              <div className="ct-actions">
                {dirty && <button type="button" className="button-quiet" onClick={() => setDrafts((all) => { const c = { ...all }; delete c[s.email]; return c; })} disabled={save.isPending} data-testid={`button-discard-staff-${id}`}>Discard</button>}
                <button type="button" className="button-primary" onClick={() => submit(s)} disabled={!dirty || save.isPending} data-testid={`button-save-staff-${id}`}>{save.isPending && save.variables?.data.email === s.email ? 'Saving...' : 'Save assignment'}</button>
              </div>
            </>}
            {!expanded && msg && <div className={`inline-message inline-message-${msg.tone}`} role="status">{msg.text}</div>}
          </li>;
        })}
      </ul>}
  </section>;
}
