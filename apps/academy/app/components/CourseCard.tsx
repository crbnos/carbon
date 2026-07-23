import { LuCircleCheck } from "react-icons/lu";
import { Link } from "react-router";
import type { modules } from "~/config";
import { path } from "~/utils/path";
import type { CourseProgress } from "~/utils/progress";

type Course = (typeof modules)[number]["courses"][number];

/** Overview card for a single course — icon, name, description, and (signed-in)
 *  a slim progress bar with lesson count. Links into the course detail page. */
export function CourseCard({
  moduleId,
  course,
  progress,
  showProgress
}: {
  moduleId: string;
  course: Course;
  progress: CourseProgress;
  showProgress: boolean;
}) {
  return (
    <Link
      to={path.to.course(moduleId, course.id)}
      className="callout-box group flex flex-col gap-3 p-5 no-underline transition-colors hover:border-ed-warm-400 hover:bg-white/70"
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 shrink-0 text-xl text-ed-ink/55 transition-colors group-hover:text-ed-brand-ink">
          {course.icon}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-ed-16 font-demi leading-snug text-ed-ink">
            {course.name}
          </h3>
        </div>
        {showProgress && progress.complete && (
          <LuCircleCheck className="mt-0.5 size-4 shrink-0 text-ed-green-strong" />
        )}
      </div>
      <p className="line-clamp-2 text-ed-13 leading-[1.55] text-ed-ink/60">
        {course.description}
      </p>
      {showProgress && progress.lessonsTotal + progress.challengesTotal > 0 && (
        <div className="mt-auto flex flex-col gap-1.5 pt-1">
          <div className="h-[3px] w-full overflow-hidden rounded-full bg-ed-hairline">
            <div
              className="h-full rounded-full bg-ed-brand transition-[width] duration-500"
              style={{ width: `${progress.percent}%` }}
            />
          </div>
          <span className="font-mono text-ed-11 text-ed-ink/45">
            {progress.lessonsDone}/{progress.lessonsTotal} lessons ·{" "}
            {progress.percent}%
          </span>
        </div>
      )}
    </Link>
  );
}
