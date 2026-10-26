import { BookOpen, RefreshCw } from 'lucide-react';
import { Link } from 'wouter';
import { coursePath, groupCourses, useCourseCatalog } from '@/lib/courses';

export function CourseNav({ location, onNavigate }: { location: string; onNavigate: () => void }) {
  const { data, isLoading, isError, refetch, isFetching } = useCourseCatalog();
  const onIndex = location === '/courses';
  const inSection = location === '/courses' || location.startsWith('/courses/');
  const groups = groupCourses(data?.courses ?? []);
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
              </ul>
            </div>
          ))}
      </div>
    </div>
  );
}

export function decodeSafe(value: string) {
  try { return decodeURIComponent(value); } catch { return value; }
}
