import { BookOpen, ClipboardCheck, RefreshCw } from 'lucide-react';
import { getGetKimeuBootstrapQueryKey, useGetKimeuBootstrap } from '@workspace/api-client-react';
import { foundationsAccess } from '@/auth/provider';
import { Link } from 'wouter';
import { coursePath, groupCourses, useCourseCatalog } from '@/lib/courses';

export function CourseNav({ location, onNavigate }: { location: string; onNavigate: () => void }) {
  const { data, isLoading, isError, refetch, isFetching } = useCourseCatalog();
  const onIndex = location === '/courses';
  const inSection = location === '/courses' || location.startsWith('/courses/') || location === '/foundations-assessment';
  const groups = groupCourses(data?.courses ?? []);
  const { data: bootstrap } = useGetKimeuBootstrap({ query: { queryKey: getGetKimeuBootstrapQueryKey() } });
  const showFa = foundationsAccess(bootstrap?.user).read;
  const faOn = location === '/foundations-assessment';
  const faLink = showFa ? <Link href="/foundations-assessment" className={`course-sub-link fa-nav-link ${faOn ? 'course-sub-active' : ''}`} title="Foundations Assessment — select a PT and record Pass or Fail" aria-current={faOn ? 'page' : undefined} onClick={onNavigate} data-testid="link-nav-foundations-assessment"><ClipboardCheck size={14} aria-hidden="true" /><span>Foundations Assessment</span></Link> : null;
  const hasFoundations = groups.some((g) => g.label === 'Foundations');
  return (
    <div className="course-nav">
      <Link href="/courses" className={`side-link ${inSection ? 'side-link-active' : ''}`} aria-current={onIndex ? 'page' : undefined} data-testid="link-nav-courses" onClick={onNavigate}>
        <BookOpen size={18} /><span>Courses</span>{inSection && <span className="nav-active-mark" />}
      </Link>
      <div className="course-sublist" aria-label="Your courses">
        {isLoading ? <div className="course-sub-skeleton" aria-label="Loading courses">{[0, 1, 2].map((i) => <span key={i} className="skeleton skeleton-line" />)}</div>
          : isError ? <button type="button" className="course-sub-retry" onClick={() => refetch()} disabled={isFetching} data-testid="button-retry-course-nav"><RefreshCw size={12} className={isFetching ? 'spin' : ''} /> Courses unavailable. Retry</button>
          : !groups.length ? <p className="course-sub-empty" data-testid="text-course-nav-empty">No assigned courses</p>
          : groups.map((group) => (
            <div key={group.label} className="course-sub-group">
              <div className="course-sub-label">{group.label}</div>
              <ul>
                {group.items.map((course) => {
                  const href = coursePath(course.workshopId);
                  const current = location === href || decodeSafe(location) === `/courses/${course.workshopId}`;
                  return <li key={course.workshopId}><Link href={href} className={`course-sub-link ${current ? 'course-sub-active' : ''}`} aria-current={current ? 'page' : undefined} title={course.name} onClick={onNavigate} data-testid={`link-nav-course-${course.workshopId}`}>{course.name}</Link></li>;
                })}
                {group.label === 'Foundations' && faLink && <li>{faLink}</li>}
              </ul>
            </div>
          ))}
        {!hasFoundations && faLink && <div className="course-sub-group"><div className="course-sub-label">Foundations</div><ul><li>{faLink}</li></ul></div>}
      </div>
    </div>
  );
}

export function decodeSafe(value: string) {
  try { return decodeURIComponent(value); } catch { return value; }
}
