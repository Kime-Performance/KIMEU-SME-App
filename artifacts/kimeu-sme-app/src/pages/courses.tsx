import type { ReactNode } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, CircleAlert, ClipboardCheck, FileText, Presentation, RefreshCw, UsersRound } from 'lucide-react';
import { Link, useParams } from 'wouter';
import { coursePath, groupCourses, stageLabel, useCourseCatalog } from '@/lib/courses';
import { decodeSafe } from '@/components/course-nav';
import { WorkshopWorkspace } from '@/components/workshop-workspace';
import { CourseOnboarding, isOnboardingCourse } from '@/components/course-onboarding';
import { getGetKimeuBootstrapQueryKey, useGetKimeuBootstrap } from '@workspace/api-client-react';

function Skeleton() {
  return <div className="session-list" aria-label="Loading courses">{[0, 1, 2].map((i) => <div className="session-skeleton" key={i}><div className="skeleton skeleton-line w-32" /><div className="skeleton skeleton-line w-56" /></div>)}</div>;
}

function Problem({ title, detail, action }: { title: string; detail: string; action: ReactNode }) {
  return <div className="state-card state-error" role="alert"><div className="state-icon"><CircleAlert size={18} /></div><div><h3>{title}</h3><p>{detail}</p>{action}</div></div>;
}

export function CoursesPage() {
  const { data, isLoading, isError, refetch, isFetching } = useCourseCatalog();
  const courses = data?.courses ?? [];
  const groups = groupCourses(courses);
  return <div className="animate-rise">
    <div className="page-heading"><div><div className="eyebrow">COURSE FRAMES</div><h1>Courses</h1><p>Browse the workshop catalog. Attendance and sign-off controls appear only for workshops you are permitted to lead or review.</p></div>
      <button type="button" className="button-quiet" onClick={() => refetch()} disabled={isFetching} data-testid="button-refresh-courses"><RefreshCw size={16} className={isFetching ? 'spin' : ''} /> Refresh</button></div>
    {isLoading ? <Skeleton /> : isError ? <Problem title="Courses could not load" detail="The course catalog was not returned. No courses have been substituted." action={<button type="button" className="button-quiet" onClick={() => refetch()} data-testid="button-retry-courses"><RefreshCw size={14} /> Try again</button>} />
      : !courses.length ? <div className="state-card"><div className="state-icon"><BookOpen size={18} /></div><div><h3>No courses available</h3><p>No workshop catalog entries are available for your account yet.</p></div></div>
      : groups.map((group) => <section key={group.label} className="course-group">
        <div className="section-title-row"><div><span className="section-kicker">STAGE</span><h2>{group.label}</h2></div><span className="count-chip">{group.items.length} {group.items.length === 1 ? 'course' : 'courses'}</span></div>
        <div className="course-index">
          {group.items.map((c) => <Link key={c.workshopId} href={coursePath(c.workshopId)} className="course-row" data-testid={`link-course-${c.workshopId}`}>
            <span className="course-row-id">{c.workshopId}</span>
            <span className="course-row-main"><strong>{c.name}</strong><small>{[c.topic, c.leadSme && `Lead SME: ${c.leadSme}`].filter(Boolean).join(' / ') || 'No topic or lead listed'}</small></span>
            <ArrowRight size={16} aria-hidden="true" />
          </Link>)}
        </div>
      </section>)}
  </div>;
}

const frames = [
  { icon: FileText, title: 'Teaching materials', detail: 'Slides, handouts and reference reading for this course will live here.' },
  { icon: Presentation, title: 'Session guidance', detail: 'Facilitation flow and timing guidance for running this course.' },
  { icon: ClipboardCheck, title: 'Practical criteria', detail: 'What a clinician must demonstrate for this course.' },
];

function CourseMaterialsFrame() {
  return <>
    <div className="course-pending-note" role="status"><BookOpen size={17} aria-hidden="true" /><span>Course content is not populated yet. These sections are the frame it will fill.</span></div>
    <div className="course-frames">
      {frames.map(({ icon: Icon, title, detail }) => <section key={title} className="course-frame" aria-label={title}>
        <div className="panel-heading"><div className="panel-icon"><Icon size={18} /></div><div><span className="section-kicker">NOT YET POPULATED</span><h2>{title}</h2></div></div>
        <p>{detail}</p>
      </section>)}
    </div>
  </>;
}

export function CourseDetailPage() {
  const { workshopId: raw = '' } = useParams<{ workshopId: string }>();
  const workshopId = decodeSafe(raw);
  const { data, isLoading, isError, refetch } = useCourseCatalog();
  const { data: bootstrap } = useGetKimeuBootstrap({ query: { queryKey: getGetKimeuBootstrapQueryKey(), refetchInterval: 30_000, refetchOnWindowFocus: true } });
  const back = <Link href="/courses" className="back-link" data-testid="link-back-courses"><ArrowLeft size={16} /> All courses</Link>;
  if (isLoading) return <div>{back}<Skeleton /></div>;
  if (isError) return <div>{back}<Problem title="Course unavailable" detail="The course catalog could not be loaded. Try again shortly." action={<button type="button" className="button-quiet" onClick={() => refetch()} data-testid="button-retry-course"><RefreshCw size={14} /> Try again</button>} /></div>;
  const course = data?.courses.find((c) => c.workshopId === workshopId);
  if (!course) return <div className="animate-rise">{back}<Problem title="This course is not available" detail="It may not exist, or your approved role cannot view it." action={<Link href="/courses" className="button-quiet" data-testid="link-not-available-courses"><ArrowLeft size={14} /> Back to courses</Link>} /></div>;
  const roles = bootstrap?.user?.roles ?? [];
  const assigned = roles.includes('Admin') || (bootstrap?.user?.workshopIds ?? []).includes(course.workshopId);
  const rdWorkspace = roles.includes('Admin') || roles.includes('RD');
  const rdOnly = isOnboardingCourse(course.workshopId);
  const showTracking = !rdOnly && assigned;
  const showRdWorkspace = rdOnly && rdWorkspace;
  return <div className="animate-rise" key={course.workshopId}>
    {back}
    <div className="page-heading"><div><div className="eyebrow">{stageLabel(course.stage, course.workshopId)} / {course.workshopId}</div><h1 data-testid="text-course-name">{course.name}</h1><p>{course.topic || 'No topic listed in the catalog.'}</p></div></div>
    <dl className="course-facts">
      <div><dt>Workshop ID</dt><dd data-testid="text-course-id">{course.workshopId}</dd></div>
      <div><dt>Stage</dt><dd>{stageLabel(course.stage, course.workshopId)}</dd></div>
      <div><dt>Topic</dt><dd>{course.topic || 'Not listed'}</dd></div>
      <div><dt><UsersRound size={13} aria-hidden="true" /> Lead SME</dt><dd>{course.leadSme || 'Not listed'}</dd></div>
    </dl>
    {isOnboardingCourse(course.workshopId) && showRdWorkspace ? <CourseOnboarding key={course.workshopId} courseId={course.workshopId} /> : <>
    {showTracking ? <WorkshopWorkspace key={course.workshopId} workshopId={course.workshopId}><CourseMaterialsFrame /></WorkshopWorkspace> : <>
      <div className="course-pending-note" role="status" data-testid="status-course-view-only"><BookOpen size={17} aria-hidden="true" /><span>{rdOnly ? 'This workshop’s PT attendance and sign-offs are available only to Regional Directors and administrators.' : 'You can view this workshop. PT attendance and practical records are available only for workshops assigned to your account.'}</span></div>
      <CourseMaterialsFrame />
    </>}
    </>}
  </div>;
}
