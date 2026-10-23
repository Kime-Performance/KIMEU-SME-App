import { useMemo, useState } from 'react';
import { CalendarClock, CircleAlert, ExternalLink, Info, MapPin, RefreshCw, Search } from 'lucide-react';
import { getGetKimeuUpcomingQueryKey, useGetKimeuUpcoming } from '@workspace/api-client-react';
import type { WorkshopOccurrence } from '@workspace/api-client-react';

const TZ = 'America/Los_Angeles';
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function parseDateOnly(value: string) {
  const [y, m, d] = value.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
}

function fmtDateOnly(value: string, opts: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat('en-US', { ...opts, timeZone: 'UTC' }).format(parseDateOnly(value));
}

function fmtTimed(value: string, opts: Intl.DateTimeFormatOptions) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('en-US', { ...opts, timeZone: TZ }).format(date);
}

function describe(o: WorkshopOccurrence) {
  if (o.allDay || DATE_ONLY.test(o.start)) {
    const start = parseDateOnly(o.start);
    const endExclusive = parseDateOnly(o.end);
    const lastDay = new Date(endExclusive.getTime() - 86_400_000);
    const multi = lastDay.getTime() > start.getTime();
    const day = fmtDateOnly(o.start, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
    const last = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(lastDay);
    return { month: fmtDateOnly(o.start, { month: 'short' }), dayNum: fmtDateOnly(o.start, { day: 'numeric' }), date: multi ? `${day} – ${last}` : day, time: 'All day' };
  }
  const time = `${fmtTimed(o.start, { hour: 'numeric', minute: '2-digit' })} – ${fmtTimed(o.end, { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })}`;
  const firstDate = fmtTimed(o.start, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  const lastDate = fmtTimed(o.end, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  return { month: fmtTimed(o.start, { month: 'short' }), dayNum: fmtTimed(o.start, { day: 'numeric' }), date: firstDate === lastDate ? firstDate : `${firstDate} – ${lastDate}`, time };
}

function safeUrl(url: string | null) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : null;
  } catch {
    return null;
  }
}

export function UpcomingWorkshops() {
  const { data, isLoading, isError, isFetching, refetch, isRefetchError } = useGetKimeuUpcoming({
    query: { queryKey: getGetKimeuUpcomingQueryKey(), refetchInterval: 60_000, refetchOnWindowFocus: true },
  });
  const [search, setSearch] = useState('');
  const occurrences = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = data?.occurrences ?? [];
    return q ? list.filter((o) => o.title.toLowerCase().includes(q) || (o.location ?? '').toLowerCase().includes(q)) : list;
  }, [data, search]);
  const refreshed = data ? fmtTimed(data.refreshedAt, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }) : null;
  const through = data ? (DATE_ONLY.test(data.throughDate) ? fmtDateOnly(data.throughDate, { month: 'short', day: 'numeric', year: 'numeric' }) : fmtTimed(data.throughDate, { month: 'short', day: 'numeric', year: 'numeric' })) : null;

  return (
    <section className="upcoming-section" aria-labelledby="upcoming-title" data-testid="section-upcoming-workshops">
      <div className="section-title-row">
        <div><span className="section-kicker">NEXT 12 MONTHS{data ? ` · ${data.calendarName.toUpperCase()}` : ''}</span><h2 id="upcoming-title">Upcoming workshops</h2></div>
        <button type="button" className="button-quiet" onClick={() => refetch()} disabled={isFetching} aria-label="Refresh upcoming workshops" data-testid="button-refresh-upcoming"><RefreshCw size={15} className={isFetching ? 'spin' : ''} /> Refresh</button>
      </div>
      <div className="upcoming-note" role="note" data-testid="text-upcoming-note"><Info size={16} /><strong>Calendar is schedule reference only. SMEs record actual attendance live in the app.</strong></div>

      {data && isRefetchError && <div className="upcoming-stale" role="alert" data-testid="status-upcoming-stale"><CircleAlert size={16} /><span>Latest refresh failed. Showing older schedule data last refreshed {refreshed} — it may be out of date.</span></div>}

      {isLoading ? (
        <div className="upcoming-list" aria-busy="true">{[0, 1, 2].map((i) => <div key={i} className="upcoming-row"><div className="skeleton upcoming-skel-date" /><div style={{ display: 'grid', gap: 8, flex: 1 }}><div className="skeleton skeleton-line w-56" /><div className="skeleton skeleton-line w-32" /></div></div>)}</div>
      ) : isError && !data ? (
        <div className="state-card state-error" role="alert" data-testid="status-upcoming-error"><div className="state-icon"><CircleAlert size={18} /></div><div><h3>Upcoming schedule could not load</h3><p>The calendar reference is unavailable. No schedule has been substituted.</p><button type="button" className="button-quiet" onClick={() => refetch()}>Try again</button></div></div>
      ) : data ? (
        <>
          <div className="upcoming-toolbar">
            <label className="upcoming-search"><Search size={15} aria-hidden="true" /><span className="sr-only">Search upcoming workshops by title or location</span><input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search title or location" data-testid="input-search-upcoming" /></label>
            <span className="upcoming-meta" data-testid="text-upcoming-refreshed">Refreshed {refreshed}{through ? ` · through ${through}` : ''}</span>
          </div>
          {occurrences.length === 0 ? (
            <div className="state-card" data-testid="status-upcoming-empty"><div className="state-icon"><CalendarClock size={18} /></div><div><h3>{search ? 'No workshops match that search' : 'No upcoming workshops on the calendar'}</h3><p>{search ? 'Try a different title or location.' : 'Nothing is scheduled in the next 12 months.'}</p></div></div>
          ) : (
            <ul className="upcoming-list">
              {occurrences.map((o) => {
                const d = describe(o);
                const url = safeUrl(o.calendarUrl);
                return (
                  <li key={o.occurrenceId} className={`upcoming-row ${o.status === 'cancelled' ? 'upcoming-cancelled' : ''}`} data-testid={`row-upcoming-${o.occurrenceId}`}>
                    <div className="upcoming-date" aria-hidden="true"><span>{d.month.toUpperCase()}</span><strong>{d.dayNum}</strong></div>
                    <div className="upcoming-main">
                      <div className="upcoming-title-row"><h3>{o.title}</h3><span className={`upcoming-status up-${o.status}`}>{o.status}</span></div>
                      <div className="upcoming-details">
                        <span>{d.date} · {d.time}</span>
                        {o.location && <span><MapPin size={12} aria-hidden="true" />{o.location}</span>}
                        {o.workshopId ? <span className="upcoming-stage">{o.stage ?? 'Stage not listed'}</span> : <span className="upcoming-unmatched">Catalog match needed</span>}
                      </div>
                    </div>
                    {url && <a className="upcoming-link" href={url} target="_blank" rel="noopener noreferrer" aria-label={`View ${o.title} in Calendar (opens in new tab)`} data-testid={`link-calendar-${o.occurrenceId}`}>Calendar <ExternalLink size={13} /></a>}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      ) : null}
    </section>
  );
}
