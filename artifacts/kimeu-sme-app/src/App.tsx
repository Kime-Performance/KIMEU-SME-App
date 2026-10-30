import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ClerkProvider, Show, SignIn, SignUp, useClerk } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import {
  Activity, ArrowDownRight, ArrowLeft, ArrowRight, BookOpen, CalendarDays, Check,
  CheckCircle2, ChevronRight, CircleAlert, Clock3, Cloud, CloudOff, FileText,
  LockKeyhole, LogOut, MapPin, Menu, NotebookPen, RefreshCw, Settings2, ShieldCheck,
  UsersRound, X,
} from 'lucide-react';
import {
  getGetKimeuBootstrapQueryKey, getGetKimeuSessionQueryKey, getGetKimeuTodayQueryKey,
  useAppendKimeuClinicianNote, useCompleteKimeuSession, useGetKimeuBootstrap,
   useGetKimeuSession, useGetKimeuToday, useOpenKimeuSession,
} from '@workspace/api-client-react';
import type { BootstrapResponse, ClinicianNoteInput, SessionSummary } from '@workspace/api-client-react';
import { Link, Redirect, Route, Router as WouterRouter, Switch, useLocation, useParams } from 'wouter';
import NotFound from '@/pages/not-found';
import { useAttendanceQueue } from './hooks/use-attendance-queue';
import { UpcomingWorkshops } from './components/upcoming-workshops';
import { CourseNav, decodeSafe } from './components/course-nav';
import { CoursesPage, CourseDetailPage } from './pages/courses';
import { FellowshipReviewsPage } from './pages/fellowship-reviews';
import { FoundationsAssessmentPage } from './pages/foundations-assessment';
import { useCourseCatalog } from './lib/courses';
import { SmeAssignmentsPanel } from './components/sme-assignments';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true, staleTime: 15_000 } },
});
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const clerkPubKey = publishableKeyFromHost(window.location.hostname, import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;

function stripBase(path: string) {
  return basePath && path.startsWith(basePath) ? path.slice(basePath.length) || '/' : path;
}

if (!clerkPubKey) throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY in .env file');

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: 'clerk',
  options: {
    logoPlacement: 'inside' as const,
    logoLinkUrl: basePath || '/',
    logoImageUrl: `${window.location.origin}${basePath}/brand/kimeu-wordmark.png`,
  },
  variables: {
    colorPrimary: '#2767F4',
    colorForeground: '#2A2A2A',
    colorMutedForeground: '#525a66',
    colorDanger: '#c93b3a',
    colorBackground: '#ffffff',
    colorInput: '#f4f6f9',
    colorInputForeground: '#2A2A2A',
    colorNeutral: '#dde2e9',
    fontFamily: 'Open Sans',
    borderRadius: '0.25rem',
  },
  elements: {
    rootBox: 'w-full flex justify-center',
    cardBox: 'bg-[#ffffff] rounded-[4px] border-t-[6px] border-[#2A2A2A] w-[440px] max-w-full overflow-hidden',
    card: '!shadow-none !border-0 !bg-transparent !rounded-none',
    footer: '!shadow-none !border-0 !bg-transparent !rounded-none',
    headerTitle: 'text-[#2A2A2A] font-bold uppercase tracking-wide text-[28px] leading-none [font-family:Teko,Arial_Narrow,sans-serif]',
    headerSubtitle: 'text-[#525a66]',
    socialButtonsBlockButtonText: 'text-[#2A2A2A] font-medium',
    formFieldLabel: 'text-[#2A2A2A] font-medium',
    footerActionLink: 'text-[#2767F4] font-semibold',
    footerActionText: 'text-[#525a66]',
    dividerText: 'text-[#525a66]',
    identityPreviewEditButton: 'text-[#2767F4]',
    formFieldSuccessText: 'text-[#2767F4]',
    alertText: 'text-[#8f2e2d]',
    logoBox: 'h-9',
    logoImage: 'h-9 w-auto',
    socialButtonsBlockButton: 'border-[#dde2e9] bg-[#ffffff] hover:bg-[#f4f6f9]',
    formButtonPrimary: 'bg-[#2A2A2A] hover:bg-[#224DBE] text-white uppercase tracking-wider font-bold',
    formFieldInput: 'bg-[#f4f6f9] border-[#dde2e9] text-[#2A2A2A]',
    footerAction: 'border-t border-[#dde2e9]',
    dividerLine: 'bg-[#dde2e9]',
    alert: 'border-[#f2c7c6] bg-[#fdecec]',
    otpCodeFieldInput: 'border-[#dde2e9] bg-[#f4f6f9]',
    formFieldRow: 'gap-2',
    main: 'gap-5',
  },
};

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const client = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (prevUserIdRef.current !== undefined && prevUserIdRef.current !== userId) client.clear();
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, client]);
  return null;
}

function SignInPage() {
  return <div className="auth-wall"><div className="auth-intro"><BrandMark /><span>PRIVATE KIMEU WORKSPACE</span><h1>Good work starts with a clear record.</h1><p>Sign in with your approved work account. Access is limited to KIMEU SMEs, Regional Directors, Fellowship reviewers, and administrators.</p></div><SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} appearance={{ elements: { footerAction: { display: 'none' } } }} /></div>;
}

function SignUpPage() {
  // Invitation redemption still needs Clerk's canonical sign-up route. Hiding
  // public registration is not the security boundary: Sheets authorization
  // protects every API, and Clerk's Restricted mode must be enabled separately.
  if (!new URLSearchParams(window.location.search).has('__clerk_ticket')) {
    return <div className="auth-wall"><div className="auth-intro"><BrandMark /><span>PRIVATE KIMEU WORKSPACE</span><h1>Access by invitation.</h1><p>Ask the KIMEU Director to approve your SME or Regional Director account. Creating an account alone does not grant access.</p><Link href="/sign-in" className="button-primary" data-testid="link-approved-sign-in">Return to sign in</Link></div></div>;
  }
  return <div className="auth-wall"><div className="auth-intro"><BrandMark /><span>KIMEU WORKSHOP NETWORK</span><h1>Make room for better practice.</h1><p>Access is confirmed against your organisation and assigned workshops.</p></div><SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} /></div>;
}

function HomePage() {
  return (
    <main className="welcome-page paper-grain">
      <Show when="signed-in"><Redirect to="/today" /></Show>
      <header className="welcome-nav"><BrandLockup /><Link href="/sign-in" className="nav-signin" data-testid="link-sign-in">Sign in <ArrowRight size={16} /></Link></header>
      <section className="welcome-hero">
        <div className="hero-copy animate-rise">
          <div className="eyebrow"><span className="live-dot" /> KIMEU WORKSHOP OPERATIONS</div>
          <h1>Good sessions.<br /><em>Clear records.</em></h1>
          <p>One calm place to run the room, mark attendance and keep the next step in view.</p>
          <div className="hero-actions"><Link href="/sign-in" className="button-primary" data-testid="link-get-started">Continue to KIMEU <ArrowRight size={17} /></Link><span className="privacy-line"><ShieldCheck size={15} /> Access is managed by your organisation</span></div>
        </div>
        <div className="hero-board animate-rise-delay" aria-label="KIMEU workshop field notebook illustration">
          <div className="board-top"><div><span className="board-kicker">FIELD NOTE / 01</span><h2>Today, in focus</h2></div><div className="board-glyph"><Activity size={20} /></div></div>
          <div className="board-rule" />
          <div className="board-row"><span className="board-index">01</span><div><strong>Session roster</strong><small>See who is expected</small></div><ChevronRight size={17} /></div>
          <div className="board-row"><span className="board-index">02</span><div><strong>Attendance</strong><small>Mark clearly, as it happens</small></div><ChevronRight size={17} /></div>
          <div className="board-row"><span className="board-index">03</span><div><strong>Close the loop</strong><small>Leave the next session ready</small></div><ChevronRight size={17} /></div>
          <div className="board-footer"><span className="sync-mark"><span /> SYNC STATUS</span><span>Connected when configured</span></div>
        </div>
        <div className="hero-index">A PRIVATE FIELD TOOL FOR<br />KIMEU SMEs & REGIONAL DIRECTORS</div>
      </section>
      <section className="welcome-lower">
        <div className="welcome-caption"><span>01 — THE WORKFLOW</span><strong>Built for the room,<br />not the spreadsheet.</strong></div>
        <div className="welcome-points">
          <div><CalendarDays /><h3>Know what’s today</h3><p>Sessions and pending attendance are visible at a glance.</p></div>
          <div><UsersRound /><h3>Keep the roster moving</h3><p>Clear present, absent and unmarked states for each person.</p></div>
          <div><Cloud /><h3>Trust the sync state</h3><p>Setup and connection issues are shown plainly—never dressed up as saved.</p></div>
        </div>
      </section>
      <footer className="welcome-footer"><BrandLockup tone="dark" /><span>Designed for dependable workshop operations.</span></footer>
    </main>
  );
}

function BrandMark({ tone = 'light' }: { tone?: 'light' | 'dark' }) {
  return <img className="brand-wordmark" src={`${basePath}/brand/${tone === 'dark' ? 'kimeu-wordmark-reversed' : 'kimeu-wordmark'}.png`} alt="KIMEU" />;
}
function BrandLockup({ tone = 'light' }: { tone?: 'light' | 'dark' }) {
  return <Link href="/" className={`brand-lockup brand-lockup-${tone}`} data-testid="link-brand-home"><BrandMark tone={tone} /><span><small>SME APP</small></span></Link>;
}

function Shell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { data: bootstrap, isLoading, isError, refetch } = useGetKimeuBootstrap({
    query: { queryKey: getGetKimeuBootstrapQueryKey(), refetchInterval: 30_000, refetchOnWindowFocus: true },
  });
  const { signOut } = useClerk();
  const [menuOpen, setMenuOpen] = useState(false);
  const admin = bootstrap?.user?.roles?.some((role) => role.toLowerCase() === 'admin') ?? false;
  const reviewer = admin || (bootstrap?.user?.roles.includes('Fellowship Reviewer') ?? false);
  const links = [{ href: '/today', label: 'Today', icon: CalendarDays }, ...(reviewer ? [{ href: '/fellowship-reviews', label: 'Fellowship Reviews', icon: NotebookPen }] : []), ...(admin ? [{ href: '/settings', label: 'Settings', icon: Settings2 }] : [])];
  if (isLoading) return <main className="auth-wall" role="status"><p>Checking your KIMEU access…</p></main>;
  if (!bootstrap) return <main className="auth-wall"><ErrorState title="Access could not be verified" detail="The workspace stays locked until your access is confirmed." retry={() => refetch()} /></main>;
  if (bootstrap.access !== 'allowed') return <main className="auth-wall"><div className="auth-intro"><BrandMark /><span>PRIVATE KIMEU WORKSPACE</span><h1>Approved access required.</h1><p>This workspace is available only to active, approved SMEs, Regional Directors, Fellowship reviewers, and administrators. Contact the KIMEU Director about your access.</p><AccessBanner bootstrap={bootstrap} /><button type="button" className="button-primary" onClick={() => signOut({ redirectUrl: basePath || '/' })} data-testid="button-denied-sign-out">Sign out</button></div></main>;
  return (
    <div className="app-shell">
      <aside className={`sidebar ${menuOpen ? 'sidebar-open' : ''}`}>
        <BrandLockup tone="dark" />
        <div className="sidebar-label">WORKSPACE</div>
        <nav className="side-nav" aria-label="Main navigation">
          {links.map(({ href, label, icon: Icon }) => <Link key={href} href={href} className={`side-link ${location === href ? 'side-link-active' : ''}`} aria-current={location === href ? 'page' : undefined} data-testid={`link-nav-${label.toLowerCase()}`} onClick={() => setMenuOpen(false)}><Icon size={18} /><span>{label}</span>{location === href && <span className="nav-active-mark" />}</Link>)}
          <CourseNav location={location} onNavigate={() => setMenuOpen(false)} />
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-quiet"><div className="sidebar-quiet-icon"><BookOpen size={18} /></div><p>Keep the record<br />close to the work.</p></div>
          <SessionUser />
        </div>
      </aside>
      {menuOpen && <button type="button" className="mobile-scrim" aria-label="Close menu" onClick={() => setMenuOpen(false)} data-testid="button-close-menu" />}
      <main className="main-area">
        <header className="topbar">
          <button type="button" className="mobile-menu" aria-label="Open menu" onClick={() => setMenuOpen(true)} data-testid="button-open-menu"><Menu size={21} /></button>
          <div className="crumb"><span>KIMEU</span><span className="crumb-slash">/</span>{location.startsWith('/courses') ? <CourseCrumb location={location} /> : <b>{location === '/today' ? 'Today' : location === '/fellowship-reviews' ? 'Fellowship Reviews' : location === '/foundations-assessment' ? 'Foundations Assessment' : location.startsWith('/session') ? 'Session' : 'Settings'}</b>}</div>
          <SyncStatus />
        </header>
        {isError && <div className="access-banner" role="alert" data-testid="status-access-refresh-error"><CircleAlert size={18} /><div><strong>Access refresh unavailable</strong><span>Your last verified workspace and unsaved forms are kept open. Every save still checks current staff access on the server.</span></div><button type="button" className="button-quiet" onClick={() => refetch()}>Retry</button></div>}
        <AccessBanner bootstrap={bootstrap} />
        <div className="access-banner" role="status" data-testid="status-tracking-mode"><Cloud size={18} /><div><strong>{bootstrap.readiness.trackingMode === 'live' ? 'Live KIMEU Master tracking' : bootstrap.readiness.trackingMode === 'test' ? 'Test-copy tracking only' : 'Tracking connection unavailable'}</strong><span>{bootstrap.readiness.trackingMode === 'live' ? 'Saved inputs update the KIMEU Master Database. The sheet calculates completion; downstream tools use that data on refresh.' : bootstrap.readiness.trackingMode === 'test' ? 'Saved inputs stay in the test copy. They do not update the live Master or Clinician Development Tool.' : 'Do not assume changes have reached the Master until the connection is restored.'}</span></div></div>
        <div className="page-content">{children}</div>
      </main>
    </div>
  );
}

function CourseCrumb({ location }: { location: string }) {
  const { data } = useCourseCatalog();
  if (location === '/courses') return <b aria-current="page">Courses</b>;
  const id = decodeSafe(location.slice('/courses/'.length));
  const name = data?.courses.find((course) => course.workshopId === id)?.name ?? 'Course';
  return <><Link href="/courses" className="crumb-link" data-testid="link-crumb-courses">Courses</Link><span className="crumb-slash">/</span><b className="crumb-current" aria-current="page" title={name}>{name}</b></>;
}

function SessionUser() {
  const { user, signOut, openUserProfile } = useClerk();
  const name = user?.fullName || user?.primaryEmailAddress?.emailAddress || 'Signed in';
  return <div className="session-user"><div className="user-initial">{name.slice(0, 1).toUpperCase()}</div><div className="user-copy"><strong>{name}</strong><span>Workshop access</span></div><button type="button" onClick={() => openUserProfile()} aria-label="Account and password settings" title="Account and password settings" className="logout-button" data-testid="button-account-security"><ShieldCheck size={16} /></button><button type="button" onClick={() => signOut({ redirectUrl: basePath || '/' })} aria-label="Sign out" className="logout-button" data-testid="button-sign-out"><LogOut size={16} /></button></div>;
}

function SyncStatus() {
  const { data, isLoading, isError, refetch, isFetching } = useGetKimeuBootstrap();
  if (isLoading) return <div className="sync-pill sync-loading" data-testid="status-sync-loading"><span className="skeleton-dot" /> Checking connection</div>;
  if (isError || !data?.readiness.configured) return <button type="button" onClick={() => refetch()} className="sync-pill sync-blocked" data-testid="status-sync-blocked"><CloudOff size={15} /> Setup required</button>;
  return <button type="button" onClick={() => refetch()} className="sync-pill sync-ready" data-testid="status-sync-ready"><span className="sync-indicator" />{isFetching ? 'Syncing' : 'Connection ready'}<RefreshCw size={13} className={isFetching ? 'spin' : ''} /></button>;
}

function AccessBanner({ bootstrap }: { bootstrap: BootstrapResponse | undefined }) {
  if (!bootstrap || bootstrap.access === 'allowed') return null;
  const content = {
    domain_denied: ['Access not available', 'This account is outside the permitted organisation domain. Contact your KIMEU administrator.'],
    inactive: ['Account inactive', 'Your account is not currently active for KIMEU. Ask an administrator to review your access.'],
    role_denied: ['Access not permitted', 'Only approved SMEs, Regional Directors, Fellowship reviewers, and administrators can use this workspace.'],
    not_configured: ['Workspace setup incomplete', 'The workshop sheet connection is not configured. Session data and writes are unavailable until setup is complete.'],
  }[bootstrap.access];
  if (!content) return null;
  return <div className="access-banner" role="status" data-testid={`status-access-${bootstrap.access}`}><CircleAlert size={18} /><div><strong>{content[0]}</strong><span>{content[1]}</span></div></div>;
}

function PageHeading({ eyebrow, title, detail, action }: { eyebrow: string; title: string; detail: string; action?: ReactNode }) {
  return <div className="page-heading"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{detail}</p></div>{action}</div>;
}

function TodayPage() {
  const { data: bootstrap } = useGetKimeuBootstrap();
  const { data, isLoading, isError, refetch, isFetching } = useGetKimeuToday();
  const openSession = useOpenKimeuSession();
  const client = useQueryClient();
  const [, setLocation] = useLocation();
  const [workshopId, setWorkshopId] = useState('');
  const [sessionDate, setSessionDate] = useState(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()));
  const canWrite = Boolean(bootstrap?.readiness.configured && bootstrap.readiness.writeEnabled && bootstrap.access === 'allowed');
  const sessions = data?.sessions ?? [];
  const pending = sessions.filter((session) => session.unmarkedCount > 0 && session.sessionStatus !== 'Complete');
  const dayLabel = data?.date ? formatDate(data.date, { weekday: 'long', month: 'long', day: 'numeric' }) : 'Workshop overview';
  function launch(session: SessionSummary) {
    if (session.sessionStatus !== 'Scheduled') {
      setLocation(`/session/${encodeURIComponent(session.sessionId)}`);
      return;
    }
    openSession.mutate({ data: { workshopId: session.workshopId, sessionDate: session.sessionDate } }, {
      onSuccess: (detail) => {
        client.setQueryData(getGetKimeuSessionQueryKey(detail.session.sessionId), detail);
        client.invalidateQueries({ queryKey: getGetKimeuTodayQueryKey() });
        setLocation(`/session/${encodeURIComponent(detail.session.sessionId)}`);
      },
    });
  }
  return <div className="animate-rise">
    <PageHeading eyebrow={dayLabel.toUpperCase()} title="Today" detail="A clear view of the work in front of you." action={<button type="button" className="button-quiet" onClick={() => refetch()} disabled={isFetching} data-testid="button-refresh-today"><RefreshCw size={16} className={isFetching ? 'spin' : ''} /> Refresh</button>} />
    {bootstrap?.user?.roles.some((role) => ['Admin', 'Foundations SME', 'Elite SME'].includes(role)) && <form className="note-form settings-card" onSubmit={(event) => {
      event.preventDefault();
      openSession.mutate({ data: { workshopId, sessionDate } }, { onSuccess: (detail) => {
        client.invalidateQueries({ queryKey: getGetKimeuTodayQueryKey() });
        setLocation(`/session/${encodeURIComponent(detail.session.sessionId)}`);
      } });
    }}>
      <h2>Open a workshop session</h2>
      <div className="form-two"><label>Workshop ID<input value={workshopId} onChange={(event) => setWorkshopId(event.target.value)} list="assigned-workshops" required placeholder="Choose an assigned workshop" /><datalist id="assigned-workshops">{bootstrap.user.workshopIds.map((id) => <option key={id} value={id} />)}</datalist></label><label>Session date<input type="date" value={sessionDate} onChange={(event) => setSessionDate(event.target.value)} required /></label></div>
      <button type="submit" className="button-primary button-small" disabled={!canWrite || openSession.isPending}>Open session <ArrowRight size={16} /></button>
      {openSession.isError && <p role="alert">The session could not be opened. Verify the workshop assignment, date and sheet connection.</p>}
    </form>}
    {data && <section className="today-summary" aria-label="Today's overview">
      <div className="summary-primary"><div className="summary-icon"><CalendarDays size={19} /></div><div><span>SESSIONS TODAY</span><strong data-testid="text-session-count">{data.sessions.length}</strong></div></div>
      <div className="summary-divider" />
      <div className="summary-secondary"><span className="summary-number">{data.dueCount}</span><span>attendance items<br />awaiting review</span><ArrowDownRight size={18} /></div>
      <div className="summary-note">The count follows the connected workshop record.</div>
    </section>}
    <section className="list-section">
      <div className="section-title-row"><div><span className="section-kicker">YOUR WORKSHOP DAY</span><h2>Session list</h2></div>{data && <span className="count-chip">{sessions.length} {sessions.length === 1 ? 'session' : 'sessions'}</span>}</div>
      {isLoading ? <div className="session-list">{[0, 1].map((item) => <div className="session-skeleton" key={item}><div className="skeleton skeleton-line w-32" /><div className="skeleton skeleton-line w-56" /><div className="skeleton skeleton-line w-40" /></div>)}</div> : isError ? <ErrorState title="Today’s sessions could not load" detail="Check the connection and try again. No session records have been substituted." retry={() => refetch()} /> : !bootstrap?.readiness.configured ? <EmptyState icon={<CloudOff />} title="Sheet connection required" detail="The configured workshop sheet is not ready. Once an administrator connects it, today's sessions will appear here." /> : !sessions.length ? <EmptyState icon={<CalendarDays />} title="No sessions returned for today" detail="There are no session records for this date in the connected workshop sheet." /> : (
        <div className="session-list">
          {sessions.map((session) => <SessionCard key={session.sessionId} session={session} pending={pending.some((item) => item.sessionId === session.sessionId)} onOpen={() => launch(session)} opening={openSession.isPending && openSession.variables?.data.workshopId === session.workshopId} disabled={!canWrite && session.sessionStatus === 'Scheduled'} />)}
        </div>
      )}
    </section>
    <section className="pending-strip">
      <div className="pending-icon"><Clock3 size={19} /></div><div className="pending-copy"><span>ATTENDANCE CHECK</span><strong>{data ? (data.dueCount === 0 ? 'All attendance is up to date.' : `${data.dueCount} attendance item${data.dueCount === 1 ? '' : 's'} still need a mark.`) : 'Waiting for session data.'}</strong></div><span className={`pending-state ${data && data.dueCount === 0 ? 'pending-state-good' : ''}`}>{data && data.dueCount === 0 ? 'CLEAR' : 'IN PROGRESS'}</span>
    </section>
    <UpcomingWorkshops />
  </div>;
}

function SessionCard({ session, pending, onOpen, opening, disabled }: { session: SessionSummary; pending: boolean; onOpen: () => void; opening: boolean; disabled: boolean }) {
  const complete = session.sessionStatus === 'Complete';
  return <article className="session-card" data-testid={`card-session-${session.sessionId}`}>
    <div className="card-time"><span className={`status-dot status-${session.sessionStatus.toLowerCase()}`} /><strong>{session.startTime || 'Time not listed'}</strong><span>{formatDate(session.sessionDate, { month: 'short', day: 'numeric' })}</span></div>
    <div className="card-main"><div className="card-title-row"><h3>{session.workshopName}</h3><StatusTag status={session.sessionStatus} /></div><div className="card-meta">{session.stage && <span>{session.stage}</span>}{session.location && <span><MapPin size={13} />{session.location}</span>}{session.leadSme && <span><UsersRound size={13} />{session.leadSme}</span>}</div>
      <div className="card-progress"><div className="progress-track"><span style={{ width: `${session.rosterCount ? Math.round((session.presentCount / session.rosterCount) * 100) : 0}%` }} /></div><span>{session.presentCount} present</span><span className="progress-sep">/</span><span>{session.rosterCount} expected</span>{pending && <span className="needs-mark">{session.unmarkedCount} unmarked</span>}</div>
    </div>
    <button type="button" className={`card-action ${complete ? 'card-action-done' : ''}`} onClick={onOpen} disabled={opening || disabled} data-testid={`button-open-session-${session.sessionId}`}>{opening ? 'Opening…' : complete ? 'View record' : session.sessionStatus === 'Scheduled' ? 'Open session' : 'Take attendance'}<ArrowRight size={16} /></button>
  </article>;
}

function StatusTag({ status }: { status: string }) {
  return <span className={`status-tag tag-${status.toLowerCase()}`} data-testid={`status-session-${status.toLowerCase()}`}>{status}</span>;
}

function SessionPage() {
  const { sessionId = '' } = useParams<{ sessionId: string }>();
  const { data: bootstrap } = useGetKimeuBootstrap();
  const { data, isLoading, isError, refetch } = useGetKimeuSession(sessionId, { query: { enabled: Boolean(sessionId), queryKey: getGetKimeuSessionQueryKey(sessionId) } });
  const completeSession = useCompleteKimeuSession();
  const appendNote = useAppendKimeuClinicianNote();
  const client = useQueryClient();
  const [, setLocation] = useLocation();
  const [closeOpen, setCloseOpen] = useState(false);
  const [sessionNotes, setSessionNotes] = useState('');
  const [changes, setChanges] = useState('');
  const [confirmUnmarked, setConfirmUnmarked] = useState(false);
  const [writeMessage, setWriteMessage] = useState('');
  const [noteEmail, setNoteEmail] = useState('');
  const [noteType, setNoteType] = useState<ClinicianNoteInput['noteType']>('Session observation');
  const [noteText, setNoteText] = useState('');
  const [followUp, setFollowUp] = useState(false);
  const [followUpDue, setFollowUpDue] = useState('');
  const [visibility, setVisibility] = useState<ClinicianNoteInput['visibility']>('All');
  const [noteMessage, setNoteMessage] = useState('');
  const canWrite = Boolean(bootstrap?.readiness.configured && bootstrap.readiness.writeEnabled && bootstrap.access === 'allowed');
  const canRecord = canWrite && Boolean(bootstrap?.user?.roles.some((role) => ['Admin', 'Foundations SME', 'Elite SME'].includes(role))) && data?.session.sessionStatus === 'Live';
  const attendanceQueue = useAttendanceQueue(sessionId, canRecord);
  const privacyReady = Boolean(bootstrap?.readiness.notePrivacyReady);
  const session = data?.session;
  const isComplete = session?.sessionStatus === 'Complete';
  const noteBusy = appendNote.isPending;
  const completeBusy = completeSession.isPending;
  const saveBusy = attendanceQueue.syncing;
  function markAttendance(clinicianEmail: string, attended: 'Yes' | 'No') {
    setWriteMessage('');
    attendanceQueue.mark(clinicianEmail, attended);
  }
  function closeSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session) return;
    completeSession.mutate({ sessionId, data: { sessionNotes, changesForNextSession: changes, confirmUnmarked } }, {
      onSuccess: (summary) => {
        client.setQueryData(getGetKimeuSessionQueryKey(sessionId), (old: typeof data | undefined) => old ? { ...old, session: summary, sessionNotes, changesForNextSession: changes } : old);
        client.invalidateQueries({ queryKey: getGetKimeuTodayQueryKey() });
        setWriteMessage(`Session marked ${summary.sessionStatus}. Server status is now visible above.`);
        setCloseOpen(false);
      },
      onError: () => setWriteMessage('The session could not be closed. Review unmarked attendance and try again.'),
    });
  }
  function saveClinicianNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session || !privacyReady || !noteEmail || !noteText.trim()) return;
    appendNote.mutate({ data: {
      clinicianEmail: noteEmail,
      noteType,
      workshopId: session.workshopId,
      sessionId,
      note: noteText.trim(),
      followUpNeeded: followUp,
      followUpDue: followUp && followUpDue ? followUpDue : null,
      visibility,
    } }, {
      onSuccess: () => {
        setNoteText('');
        setNoteMessage('Note added to the clinician record.');
      },
      onError: () => setNoteMessage('Note was not saved. Check the connection and retry.'),
    });
  }
  if (isLoading) return <Shell><SessionSkeleton /></Shell>;
  if (isError || !data) return <Shell><ErrorState title="Session record unavailable" detail="The session could not be loaded from the connected source. No roster has been created locally." retry={() => refetch()} /></Shell>;
  return <Shell>
    <div className="animate-rise">
      <button type="button" onClick={() => setLocation('/today')} className="back-link" data-testid="button-back-today"><ArrowLeft size={16} /> Back to today</button>
      <PageHeading eyebrow={`${session?.workshopId} · ${formatDate(session?.sessionDate || '', { weekday: 'long', month: 'long', day: 'numeric' })}`} title={session?.workshopName || 'Session'} detail={[session?.stage, session?.location, session?.startTime].filter(Boolean).join(' · ')} action={session && <StatusTag status={session.sessionStatus} />} />
      {writeMessage && <div className={`inline-message ${writeMessage.includes('not') || writeMessage.includes('could not') ? 'inline-message-error' : 'inline-message-success'}`} role="status" data-testid="status-session-write">{writeMessage}</div>}
      {attendanceQueue.message && <div className="inline-message" role="status">{attendanceQueue.message} {attendanceQueue.pendingCount > 0 && <button type="button" className="button-quiet" onClick={() => void attendanceQueue.retry()} disabled={attendanceQueue.syncing}>Retry {attendanceQueue.pendingCount} pending</button>}</div>}
      <section className="roster-section">
        <div className="section-title-row"><div><span className="section-kicker">LIVE SESSION</span><h2>Attendance roster</h2></div><button type="button" className="button-quiet" onClick={() => refetch()} data-testid="button-refresh-roster"><RefreshCw size={15} /> Refresh</button></div>
        <div className="roster-summary">
          <div><span className="roster-stat-value">{session?.presentCount}</span><span>Present</span></div>
          <div><span className="roster-stat-value">{session?.absentCount}</span><span>Absent</span></div>
          <div className={session?.unmarkedCount ? 'roster-unmarked' : ''}><span className="roster-stat-value">{session?.unmarkedCount}</span><span>Unmarked</span></div>
          <div className="roster-summary-total"><span>{session?.rosterCount}</span><small>ON ROSTER</small></div>
        </div>
        {data.roster.length === 0 ? <EmptyState icon={<UsersRound />} title="No roster returned" detail="The connected session record contains no roster entries." /> : <div className="roster-table">
          <div className="roster-head"><span>CLINICIAN</span><span>RECORD SOURCE</span><span>STATUS</span><span>MARK</span></div>
          {data.roster.map((person) => <div key={person.clinicianEmail} className="roster-row" data-testid={`row-roster-${person.clinicianEmail}`}>
            <div className="roster-person"><div className="person-avatar">{person.name.trim().slice(0, 1).toUpperCase()}</div><div><strong>{person.name}</strong><small>{person.clinicianEmail}</small></div></div>
            <div className="roster-source"><span>{person.sourceTab}</span></div>
            <div className="roster-computed"><span className={`attendance-label ${person.attended ? `att-${person.attended.toLowerCase()}` : 'att-pending'}`}>{person.computedStatus || (person.attended || 'Unmarked')}</span>{person.practicalStatus && <small>{person.practicalStatus}</small>}</div>
             <div className="attendance-actions"><button type="button" onClick={() => markAttendance(person.clinicianEmail, 'Yes')} disabled={!canRecord || saveBusy} className={`mark-button mark-yes ${person.attended === 'Yes' ? 'mark-selected' : ''}`} aria-label={`Mark ${person.name} present`} data-testid={`button-mark-present-${person.clinicianEmail}`}><Check size={15} /><span>Present</span></button><button type="button" onClick={() => markAttendance(person.clinicianEmail, 'No')} disabled={!canRecord || saveBusy} className={`mark-button mark-no ${person.attended === 'No' ? 'mark-selected' : ''}`} aria-label={`Mark ${person.name} absent`} data-testid={`button-mark-absent-${person.clinicianEmail}`}><X size={15} /><span>Absent</span></button></div>
          </div>)}
        </div>}
        {!canWrite && <div className="soft-warning"><LockKeyhole size={16} /> Attendance updates are disabled until the sheet is configured and writing is enabled.</div>}
      </section>
      <div className="session-work-grid">
        <section className="note-panel">
          <div className="panel-heading"><div className="panel-icon"><NotebookPen size={19} /></div><div><span className="section-kicker">APPEND-ONLY RECORD</span><h2>Clinician note</h2></div></div>
          {!privacyReady ? <div className="privacy-block"><LockKeyhole size={19} /><div><strong>Notes are disabled for privacy</strong><p>The connected sheet is missing the required Visibility header. An administrator must resolve note privacy readiness before notes can be added.</p></div></div> : <form className="note-form" onSubmit={saveClinicianNote}>
            <label>Clinician<select value={noteEmail} onChange={(event) => setNoteEmail(event.target.value)} required data-testid="select-note-clinician"><option value="">Choose from this roster</option>{data.roster.map((person) => <option key={person.clinicianEmail} value={person.clinicianEmail}>{person.name} · {person.clinicianEmail}</option>)}</select></label>
            <div className="form-two"><label>Note type<select value={noteType} onChange={(event) => setNoteType(event.target.value as ClinicianNoteInput['noteType'])} data-testid="select-note-type"><option>Session observation</option><option>Strength</option></select></label><label>Visibility<select value={visibility} onChange={(event) => setVisibility(event.target.value as ClinicianNoteInput['visibility'])} data-testid="select-note-visibility"><option>All</option><option>Aaron + author</option></select></label></div>
            <label>Observation<textarea value={noteText} onChange={(event) => setNoteText(event.target.value)} placeholder="Write a specific observation…" rows={3} required data-testid="input-clinician-note" /></label>
            <label className="check-row"><input type="checkbox" checked={followUp} onChange={(event) => setFollowUp(event.target.checked)} data-testid="checkbox-follow-up" /> Follow-up needed</label>
            {followUp && <label>Follow-up due<input type="date" value={followUpDue} onChange={(event) => setFollowUpDue(event.target.value)} data-testid="input-follow-up-due" /></label>}
            {noteMessage && <div className="form-message" role="status" data-testid="status-note-write">{noteMessage}</div>}
            <button className="button-primary button-small" type="submit" disabled={!canWrite || noteBusy || !noteText.trim() || !noteEmail} data-testid="button-save-clinician-note">{noteBusy ? 'Saving note…' : 'Add clinician note'}<ArrowRight size={15} /></button>
          </form>}
          {privacyReady && !canWrite && <div className="soft-warning"><LockKeyhole size={15} /> Notes are unavailable while writes are disabled.</div>}
        </section>
        <section className="close-panel">
          <div className="panel-heading"><div className="panel-icon panel-icon-warm"><FileText size={19} /></div><div><span className="section-kicker">SESSION CLOSE</span><h2>Leave a clear handoff</h2></div></div>
          <div className="close-current"><span className="close-state-dot" /><div><strong>{isComplete ? 'This session is complete' : 'Session remains open'}</strong><small>Status from connected session record</small></div></div>
           {isComplete ? <div className="completed-banner"><CheckCircle2 size={18} /><span>Completed status confirmed by server.</span></div> : !closeOpen ? <div className="close-intro"><p>Record the session notes and what should change next time. Completion is saved back to the connected sheet.</p><button type="button" className="button-primary" onClick={() => { setSessionNotes(data.sessionNotes || ''); setChanges(data.changesForNextSession || ''); setCloseOpen(true); }} disabled={!canRecord} data-testid="button-start-close">Review and close session <ArrowRight size={16} /></button></div> : <form className="close-form" onSubmit={closeSession}>
            <label>Session notes<textarea value={sessionNotes} onChange={(event) => setSessionNotes(event.target.value)} rows={3} placeholder="What happened in this session?" data-testid="input-session-notes" /></label>
            <label>Changes for next session<textarea value={changes} onChange={(event) => setChanges(event.target.value)} rows={3} placeholder="What should the team carry forward?" data-testid="input-changes-next-session" /></label>
            {(session?.unmarkedCount || 0) > 0 && <label className="check-row check-warning"><input type="checkbox" checked={confirmUnmarked} onChange={(event) => setConfirmUnmarked(event.target.checked)} data-testid="checkbox-confirm-unmarked" /> I understand there are {session?.unmarkedCount} unmarked attendance items.</label>}
             <div className="close-actions"><button type="button" className="button-quiet" onClick={() => setCloseOpen(false)} data-testid="button-cancel-close">Cancel</button><button type="submit" className="button-primary button-small" disabled={!canWrite || completeBusy || attendanceQueue.pendingCount > 0 || ((session?.unmarkedCount || 0) > 0 && !confirmUnmarked)} data-testid="button-confirm-close">{completeBusy ? 'Closing…' : 'Complete session'}<Check size={15} /></button></div>
          </form>}
          {!canWrite && !isComplete && <div className="soft-warning"><LockKeyhole size={15} /> Session completion is disabled until setup and write access are ready.</div>}
        </section>
      </div>
    </div>
  </Shell>;
}

function SettingsPage() {
  const { data, isLoading, isError, refetch, isFetching } = useGetKimeuBootstrap();
  const { signOut, user, openUserProfile } = useClerk();
  const isAdmin = data?.user?.roles?.some((role) => role.toLowerCase() === 'admin') ?? false;
  if (isLoading) return <Shell><div className="settings-skeleton"><div className="skeleton skeleton-line w-56" /><div className="skeleton skeleton-line w-full" /><div className="skeleton skeleton-line w-40" /></div></Shell>;
  return <Shell><div className="animate-rise">
    <PageHeading eyebrow="WORKSPACE CONFIGURATION" title="Settings" detail="Connection readiness and access context for this workspace." action={<button type="button" className="button-quiet" onClick={() => refetch()} disabled={isFetching} data-testid="button-refresh-settings"><RefreshCw size={15} className={isFetching ? 'spin' : ''} /> Refresh</button>} />
    {isError || !data ? <ErrorState title="Readiness could not be checked" detail="The bootstrap service did not return configuration status. No local configuration has been assumed." retry={() => refetch()} /> : <>
      {!isAdmin && <div className="admin-notice"><LockKeyhole size={17} /><div><strong>Administrator view</strong><span>Some settings are visible only to accounts with the admin role. Your access is enforced by the server.</span></div></div>}
      <section className="settings-card"><div className="settings-card-head"><div className="panel-icon"><Cloud size={19} /></div><div><span className="section-kicker">CONNECTED SOURCE</span><h2>Sheet readiness</h2></div><span className={`readiness-badge ${data.readiness.configured ? 'ready' : 'blocked'}`}><span />{data.readiness.configured ? 'Configured' : 'Blocked'}</span></div>
        <div className="readiness-grid">
          <ReadinessRow label="Sheet connection" ready={data.readiness.configured} detail={data.readiness.configured ? `${data.readiness.trackingMode === 'live' ? 'Live KIMEU Master' : 'Test copy'} connected through the workspace Google Sheets integration.` : 'Check the Google Sheets connection and approved spreadsheet configuration. No JSON credential is required.'} />
          <ReadinessRow label="Writes enabled" ready={data.readiness.writeEnabled} detail={data.readiness.writeEnabled ? 'Session updates can be submitted.' : 'Writes are disabled until setup allows them.'} />
          <ReadinessRow label="Clinician note privacy" ready={data.readiness.notePrivacyReady} detail={data.readiness.notePrivacyReady ? 'Visibility field is ready.' : 'Notes fail closed until the Visibility header is available.'} />
        </div>
        <div className="sheet-id-row"><span>CONFIGURED SHEET ID</span><code data-testid="text-sheet-id">{isAdmin ? data.readiness.sheetId || 'Not configured' : 'Visible to administrators only'}</code></div>
        {data.readiness.missing.length > 0 && <div className="missing-list"><strong>Setup requirements reported by server</strong><ul>{data.readiness.missing.map((item) => <li key={item}><CircleAlert size={14} />{item}</li>)}</ul></div>}
      </section>
      {isAdmin && <SmeAssignmentsPanel />}
      <section className="settings-card account-card"><div className="settings-card-head"><div className="panel-icon panel-icon-warm"><ShieldCheck size={19} /></div><div><span className="section-kicker">CURRENT ACCESS</span><h2>Account status</h2></div></div>
        {data.user ? <div className="account-details"><div><span>Account</span><strong data-testid="text-account-email">{data.user.email}</strong></div><div><span>Name in sheets</span><strong>{data.user.nameInSheets || 'Not provided'}</strong></div><div><span>Access</span><strong className={data.user.active ? 'text-ready' : 'text-blocked'}>{data.user.active ? 'Active' : 'Inactive'}</strong></div><div><span>Roles</span><strong>{data.user.roles.length ? data.user.roles.join(', ') : 'None returned'}</strong></div><div className="account-wide"><span>Assigned workshops</span><strong>{data.user.workshopIds.length ? data.user.workshopIds.join(', ') : 'None returned'}</strong></div></div> : <div className="empty-inline"><UsersRound size={19} /><span>No KIMEU user record was returned for this account.</span></div>}
        <p>{user?.passwordEnabled ? 'Your account has a password. Manage it securely under Security in your account settings.' : 'No password is set on your account yet. Open your account settings, choose Security, and add a password. Password options depend on the enabled sign-in methods.'}</p>
        <button type="button" onClick={() => openUserProfile()} className="button-primary" data-testid="button-settings-password"><ShieldCheck size={15} /> {user?.passwordEnabled ? 'Manage password' : 'Set up password'}</button>
        <button type="button" onClick={() => signOut({ redirectUrl: basePath || '/' })} className="button-quiet signout-settings" data-testid="button-settings-sign-out"><LogOut size={15} /> Sign out</button>
      </section>
    </>}
  </div></Shell>;
}

function ReadinessRow({ label, ready, detail }: { label: string; ready: boolean; detail: string }) {
  return <div className="readiness-row" data-testid={`status-readiness-${label.toLowerCase().replaceAll(' ', '-')}`}><div className={`readiness-icon ${ready ? 'readiness-icon-good' : ''}`}>{ready ? <Check size={15} /> : <X size={15} />}</div><div><strong>{label}</strong><span>{detail}</span></div><b className={ready ? 'text-ready' : 'text-blocked'}>{ready ? 'Ready' : 'Blocked'}</b></div>;
}

function ErrorState({ title, detail, retry }: { title: string; detail: string; retry: () => void }) {
  return <div className="state-card state-error" role="alert" data-testid="state-error"><div className="state-icon"><CircleAlert size={21} /></div><div><h3>{title}</h3><p>{detail}</p><button type="button" className="button-quiet" onClick={retry} data-testid="button-retry"><RefreshCw size={15} /> Try again</button></div></div>;
}

function EmptyState({ icon, title, detail }: { icon: ReactNode; title: string; detail: string }) {
  return <div className="state-card state-empty" data-testid="state-empty"><div className="state-icon">{icon}</div><div><h3>{title}</h3><p>{detail}</p></div></div>;
}

function SessionSkeleton() {
  return <div className="session-skeleton-page"><div className="skeleton skeleton-line w-40" /><div className="skeleton skeleton-line w-56" /><div className="skeleton skeleton-block" /><div className="skeleton skeleton-block" /></div>;
}

function formatDate(date: string, options: Intl.DateTimeFormatOptions) {
  if (!date) return 'Date not listed';
  const parsed = new Date(`${date.slice(0, 10)}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? date : new Intl.DateTimeFormat('en', options).format(parsed);
}

function AppRoutes() {
  const [, setLocation] = useLocation();
  return <ClerkProvider
    publishableKey={clerkPubKey}
    proxyUrl={clerkProxyUrl}
    appearance={clerkAppearance}
    signInUrl={`${basePath}/sign-in`}
    signUpUrl={`${basePath}/sign-up`}
    localization={{
      signIn: { start: { title: 'Welcome back', subtitle: 'Sign in to access KIMEU operations' } },
      signUp: { start: { title: 'Request your KIMEU account', subtitle: 'Your access is confirmed by the organisation' } },
    }}
    routerPush={(to) => setLocation(stripBase(to))}
    routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
  >
    <QueryClientProvider client={queryClient}>
      <ClerkQueryClientCacheInvalidator />
      <Switch>
        <Route path="/" component={HomePage} />
        <Route path="/sign-in/*?" component={SignInPage} />
        <Route path="/sign-up/*?" component={SignUpPage} />
         <Route path="/today">{() => <><Show when="signed-in"><Shell><TodayPage /></Shell></Show><Show when="signed-out"><Redirect to="/sign-in" /></Show></>}</Route>
         <Route path="/courses">{() => <><Show when="signed-in"><Shell><CoursesPage /></Shell></Show><Show when="signed-out"><Redirect to="/sign-in" /></Show></>}</Route>
         <Route path="/fellowship-reviews">{() => <><Show when="signed-in"><Shell><FellowshipReviewsPage /></Shell></Show><Show when="signed-out"><Redirect to="/sign-in" /></Show></>}</Route>
         <Route path="/foundations-assessment">{() => <><Show when="signed-in"><Shell><FoundationsAssessmentPage /></Shell></Show><Show when="signed-out"><Redirect to="/sign-in" /></Show></>}</Route>
         <Route path="/courses/:workshopId">{() => <><Show when="signed-in"><Shell><CourseDetailPage /></Shell></Show><Show when="signed-out"><Redirect to="/sign-in" /></Show></>}</Route>
         <Route path="/session/:sessionId">{() => <><Show when="signed-in"><SessionPage /></Show><Show when="signed-out"><Redirect to="/sign-in" /></Show></>}</Route>
         <Route path="/settings">{() => <><Show when="signed-in"><SettingsPage /></Show><Show when="signed-out"><Redirect to="/sign-in" /></Show></>}</Route>
        <Route component={NotFound} />
      </Switch>
    </QueryClientProvider>
  </ClerkProvider>;
}

function App() {
  return <WouterRouter base={basePath}><AppRoutes /></WouterRouter>;
}

export default App;
