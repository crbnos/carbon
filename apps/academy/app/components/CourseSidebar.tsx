import { LuCircleCheck } from "react-icons/lu";
import { NavLink } from "react-router";
import { modules } from "~/config";
import { useProgress } from "~/hooks";
import { useOptionalUser } from "~/hooks/useUser";
import { path } from "~/utils/path";
import { getCourseProgress, toProgressSets } from "~/utils/progress";

/** Inner nav list — reused inside the mobile drawer and the desktop sidebar.
 *  `activeCourseId` force-highlights a course when the URL isn't `/course/*`
 *  (e.g. on lesson/challenge pages). */
export function CourseSidebarNav({
  activeCourseId
}: {
  activeCourseId?: string;
}) {
  const { lessonCompletions, challengeAttempts } = useProgress();
  const isSignedIn = useOptionalUser() !== null;
  const { completedLessonIds, passedTopicIds } = toProgressSets(
    lessonCompletions,
    challengeAttempts
  );

  let overallDone = 0;
  let overallTotal = 0;
  const courseProgress = new Map<
    string,
    ReturnType<typeof getCourseProgress>
  >();
  for (const module of modules) {
    for (const course of module.courses) {
      const p = getCourseProgress(course, completedLessonIds, passedTopicIds);
      courseProgress.set(course.id, p);
      overallDone += p.lessonsDone + p.challengesDone;
      overallTotal += p.lessonsTotal + p.challengesTotal;
    }
  }
  const overall =
    overallTotal === 0 ? 0 : Math.round((overallDone / overallTotal) * 100);

  return (
    <div className="flex flex-col gap-7">
      {isSignedIn && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between font-mono text-ed-11 uppercase tracking-[0.08em]">
            <span className="text-ed-ink/55">Progress</span>
            <span className="text-ed-ink/72">{overall}%</span>
          </div>
          <div className="h-[3px] w-full overflow-hidden rounded-full bg-ed-hairline">
            <div
              className="h-full rounded-full bg-ed-brand transition-[width] duration-500"
              style={{ width: `${overall}%` }}
            />
          </div>
        </div>
      )}

      <nav className="flex flex-col gap-6">
        {modules.map((module) => (
          <div key={module.id} className="flex flex-col gap-1.5">
            <p className="px-2.5 font-mono text-ed-11 font-medium uppercase tracking-[0.08em] text-ed-ink/55">
              {module.name}
            </p>
            <div className="flex flex-col gap-0.5">
              {module.courses.map((course) => {
                const p = courseProgress.get(course.id);
                const forcedActive = course.id === activeCourseId;
                return (
                  <NavLink
                    key={course.id}
                    to={path.to.course(module.id, course.id)}
                    className={({ isActive }) =>
                      [
                        "group flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-ed-14 no-underline transition-colors",
                        isActive || forcedActive
                          ? "bg-ed-accent-fill font-demi text-ed-blue-text"
                          : "font-book text-ed-ink-66 hover:bg-ed-ink/[0.04] hover:text-ed-ink"
                      ].join(" ")
                    }
                  >
                    <span className="min-w-0 truncate">{course.name}</span>
                    {isSignedIn &&
                    p &&
                    p.lessonsTotal + p.challengesTotal > 0 ? (
                      p.complete ? (
                        <LuCircleCheck className="size-3.5 shrink-0 text-ed-green-strong" />
                      ) : p.percent > 0 ? (
                        <span className="shrink-0 font-mono text-ed-11 text-ed-ink/40">
                          {p.percent}%
                        </span>
                      ) : null
                    ) : null}
                  </NavLink>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
    </div>
  );
}

/** Desktop sticky sidebar — hairline-bordered rail matching the docs Reference. */
export function CourseSidebar({ activeCourseId }: { activeCourseId?: string }) {
  return (
    <aside className="nav-scroll-fade sticky top-16 hidden h-[calc(100dvh-64px)] w-70 shrink-0 overflow-y-auto border-r border-ed-hairline px-5 py-8 scrollbar-hidden-until-scroll lg:block">
      <CourseSidebarNav activeCourseId={activeCourseId} />
    </aside>
  );
}
