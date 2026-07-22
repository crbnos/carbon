import { Link } from "react-router";
import { CourseCard } from "~/components/CourseCard";
import { LearnShell } from "~/components/LearnShell";
import { modules } from "~/config";
import { useProgress } from "~/hooks";
import { useOptionalUser } from "~/hooks/useUser";
import { path } from "~/utils/path";
import {
  getCourseProgress,
  getResumeLesson,
  toProgressSets
} from "~/utils/progress";

export default function IndexRoute() {
  const user = useOptionalUser();
  const { lessonCompletions, challengeAttempts } = useProgress();
  const { completedLessonIds, passedTopicIds } = toProgressSets(
    lessonCompletions,
    challengeAttempts
  );

  const isSignedIn = user !== null;
  const hasHistory = completedLessonIds.size > 0;
  const resume = getResumeLesson(completedLessonIds);
  const firstLesson = modules[0].courses[0].topics[0].lessons[0];

  const ctaLessonId = resume?.lesson.id ?? firstLesson.id;
  const ctaLabel =
    isSignedIn && hasHistory
      ? resume
        ? `Continue: ${resume.lesson.name}`
        : "Review from the beginning"
      : "Start your first lesson";

  return (
    <LearnShell>
      <div className="border-b border-ed-hairline pb-10">
        <p className="font-mono text-ed-12 uppercase tracking-[0.08em] text-ed-ink/55">
          Carbon Academy
        </p>
        <h1 className="reference-title mt-3">Learn Carbon, end to end</h1>
        <p className="reference-desc mt-3 max-w-2xl">
          Short video lessons and challenges that take you from the basics to
          running your whole operation. Free, and yours to track.
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-2.5">
          <Link
            to={path.to.lesson(ctaLessonId)}
            className="group relative inline-flex h-11 items-center justify-center rounded-lg px-5 no-underline"
          >
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 rounded-lg cta-btn-dark"
            />
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 rounded-lg btn-dark-hover opacity-0 transition-opacity duration-200 ease-out group-hover:opacity-100"
            />
            <span className="text-on-dark relative z-10 max-w-[70vw] truncate text-ed-15 font-book tracking-[0.15px] sm:max-w-none">
              {ctaLabel}
            </span>
          </Link>
        </div>
      </div>

      <div className="mt-12 flex flex-col gap-14">
        {modules.map((module) => (
          <section key={module.id} className="flex flex-col gap-5">
            <p className="font-mono text-ed-11 font-semibold uppercase tracking-[0.1em] text-ed-ink/50">
              {module.name}
            </p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {module.courses.map((course) => (
                <CourseCard
                  key={course.id}
                  moduleId={module.id}
                  course={course}
                  progress={getCourseProgress(
                    course,
                    completedLessonIds,
                    passedTopicIds
                  )}
                  showProgress={isSignedIn}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </LearnShell>
  );
}
