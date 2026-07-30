import {
  LuCircleCheck,
  LuCirclePlay,
  LuFlag,
  LuRotateCcw
} from "react-icons/lu";
import type { LoaderFunctionArgs } from "react-router";
import { Link, useParams } from "react-router";
import { Breadcrumb } from "~/components/Breadcrumb";
import { GlossaryText } from "~/components/GlossaryText";
import { LessonThumb } from "~/components/LessonThumb";
import { modules } from "~/config";
import { useProgress } from "~/hooks";
import { useOptionalUser } from "~/hooks/useUser";
import { path } from "~/utils/path";
import {
  getCourseProgress,
  getNextLessonInCourse,
  toProgressSets
} from "~/utils/progress";
import { formatDuration } from "~/utils/video";

export const loader = async ({ params }: LoaderFunctionArgs) => {
  const { courseId } = params;

  if (!courseId) {
    throw new Error("Course ID is required");
  }

  return {};
};

export default function CourseRoute() {
  const { lessonCompletions, challengeAttempts } = useProgress();
  const isSignedIn = useOptionalUser() !== null;

  const { moduleId, courseId } = useParams();
  const module = modules.find((module) => module.id === moduleId);
  const course = module?.courses.find((course) => course.id === courseId);

  const totalDuration =
    course?.topics.reduce((acc, topic) => {
      return (
        acc + topic.lessons.reduce((acc, lesson) => acc + lesson.duration, 0)
      );
    }, 0) ?? 0;

  const totalChallenges =
    course?.topics.reduce((acc, topic) => {
      return acc + (topic.challenge === undefined ? 0 : 1);
    }, 0) ?? 0;

  if (!course || !module) {
    throw new Error("Course not found");
  }

  const completedLessons = lessonCompletions
    .filter((completion) => completion.courseId === course.id)
    .map((completion) => completion.lessonId);

  const completedChallenges = Array.from(
    new Set(
      challengeAttempts
        .filter((attempt) => attempt.courseId === course.id && attempt.passed)
        .map((attempt) => attempt.topicId)
    )
  );

  const attemptsByTopic = challengeAttempts
    .filter((attempt) => attempt.courseId === course.id)
    .reduce<Record<string, number>>((acc, attempt) => {
      acc[attempt.topicId] = (acc[attempt.topicId] ?? 0) + 1;
      return acc;
    }, {});

  const { completedLessonIds, passedTopicIds } = toProgressSets(
    lessonCompletions,
    challengeAttempts
  );
  const progress = getCourseProgress(
    course,
    completedLessonIds,
    passedTopicIds
  );
  const nextInCourse = getNextLessonInCourse(course, completedLessonIds);

  return (
    <article className="max-w-190">
      <Breadcrumb
        items={[
          { label: "Courses", href: path.to.root },
          { label: module.name }
        ]}
      />

      <div className="mt-4 flex items-start gap-3">
        <span className="mt-1 shrink-0 text-2xl text-ed-ink/60">
          {course.icon}
        </span>
        <div className="min-w-0">
          <h1 className="reference-title">{course.name}</h1>
        </div>
      </div>
      <p className="reference-desc mt-3">
        <GlossaryText>{course.description}</GlossaryText>
      </p>

      <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-ed-hairline pt-5">
        <div className="flex items-center gap-5 font-mono text-ed-12 text-ed-ink/70">
          <span>{formatDuration(totalDuration)}</span>
          <span>
            {progress.lessonsTotal} lesson
            {progress.lessonsTotal === 1 ? "" : "s"}
          </span>
          <span>
            {totalChallenges} challenge{totalChallenges === 1 ? "" : "s"}
          </span>
        </div>
        {isSignedIn && (
          <div className="ml-auto flex min-w-[160px] flex-1 items-center gap-3">
            <div className="h-[3px] flex-1 overflow-hidden rounded-full bg-ed-hairline">
              <div
                className="h-full rounded-full bg-ed-brand transition-[width] duration-500"
                style={{ width: `${progress.percent}%` }}
              />
            </div>
            <span className="font-mono text-ed-12 text-ed-ink/60">
              {progress.percent}%
            </span>
          </div>
        )}
      </div>

      {isSignedIn && !progress.complete && nextInCourse && (
        <div className="mt-6">
          <Link
            to={path.to.lesson(nextInCourse.id)}
            className="group relative inline-flex h-10 items-center justify-center gap-2 rounded-lg px-4 no-underline"
          >
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 rounded-lg cta-btn-dark"
            />
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 rounded-lg btn-dark-hover opacity-0 transition-opacity duration-200 ease-out group-hover:opacity-100"
            />
            <span className="text-on-dark relative z-10 inline-flex items-center gap-2 text-ed-14 font-book tracking-[0.15px]">
              <LuCirclePlay className="size-3.5" />
              {progress.lessonsDone > 0 ? "Continue course" : "Start course"}
            </span>
          </Link>
        </div>
      )}

      <div className="mt-4 flex flex-col">
        {course.topics.map((topic, index) => {
          const hasChallenge = topic.challenge && topic.challenge.length > 0;
          const isChallengeCompleted =
            hasChallenge && completedChallenges.includes(topic.id);
          const isChallengeAttempted =
            hasChallenge && attemptsByTopic[topic.id];
          const challengeAttemptCount = attemptsByTopic[topic.id] ?? 0;

          return (
            <section
              key={topic.id}
              id={topic.id}
              className="mt-8 scroll-mt-24 border-t border-ed-hairline pt-8 first:mt-6"
            >
              <p className="font-mono text-ed-10 font-semibold uppercase tracking-[0.08em] text-ed-ink/50">
                Topic {String(index + 1).padStart(2, "0")}
              </p>
              <h2 className="mt-1.5 text-ed-20 font-semi text-ed-ink">
                {topic.name}
              </h2>
              <p className="mt-2 max-w-2xl text-ed-15 leading-[1.6] text-ed-ink-78">
                <GlossaryText>{topic.description}</GlossaryText>
              </p>

              <div className="mt-5 flex flex-col gap-0.5">
                {topic.lessons.map((lesson) => (
                  <LessonRow
                    key={lesson.id}
                    lessonId={lesson.id}
                    name={lesson.name}
                    duration={lesson.duration}
                    completed={completedLessons.includes(lesson.id)}
                    tocAnchor
                  />
                ))}
              </div>

              {topic.supplemental && topic.supplemental.length > 0 && (
                <div className="mt-5">
                  <p className="mb-1.5 px-3 font-mono text-ed-10 font-semibold uppercase tracking-[0.08em] text-ed-ink/45">
                    Supplemental videos
                  </p>
                  <div className="flex flex-col gap-0.5">
                    {topic.supplemental.map((lesson) => (
                      <LessonRow
                        key={lesson.id}
                        lessonId={lesson.id}
                        name={lesson.name}
                        duration={lesson.duration}
                        completed={completedLessons.includes(lesson.id)}
                      />
                    ))}
                  </div>
                </div>
              )}

              {hasChallenge ? (
                <div className="mt-5">
                  {isChallengeCompleted ? (
                    <div className="callout-box inline-flex items-center gap-2 px-4 py-2.5 text-ed-14 font-book text-ed-ink-78">
                      <LuCircleCheck className="size-4 shrink-0 text-ed-green-strong" />
                      Challenge completed
                    </div>
                  ) : (
                    <Link
                      to={path.to.challenge(topic.id)}
                      className="group relative inline-flex h-10 items-center justify-center gap-2 rounded-lg px-4 no-underline"
                    >
                      <span
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-0 rounded-lg cta-btn-dark"
                      />
                      <span
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-0 rounded-lg btn-dark-hover opacity-0 transition-opacity duration-200 ease-out group-hover:opacity-100"
                      />
                      <span className="text-on-dark relative z-10 inline-flex items-center gap-2 text-ed-14 font-book tracking-[0.15px]">
                        {isChallengeAttempted ? (
                          <LuRotateCcw className="size-3.5" />
                        ) : (
                          <LuFlag className="size-3.5" />
                        )}
                        {isChallengeAttempted
                          ? "Retake topic challenge"
                          : "Take topic challenge"}
                        {isChallengeAttempted ? (
                          <span className="text-white/55">
                            {challengeAttemptCount} attempt
                            {challengeAttemptCount === 1 ? "" : "s"}
                          </span>
                        ) : null}
                      </span>
                    </Link>
                  )}
                </div>
              ) : null}
            </section>
          );
        })}
      </div>
    </article>
  );
}

function LessonRow({
  lessonId,
  name,
  duration,
  completed,
  tocAnchor
}: {
  lessonId: string;
  name: string;
  duration: number;
  completed: boolean;
  tocAnchor?: boolean;
}) {
  return (
    <Link
      to={path.to.lesson(lessonId)}
      id={tocAnchor ? `lesson-${lessonId}` : undefined}
      data-toc-lesson={tocAnchor ? "" : undefined}
      data-toc-title={tocAnchor ? name : undefined}
      className="flex scroll-mt-24 items-center justify-between gap-3 rounded-lg px-2 py-2 no-underline transition-colors hover:bg-ed-ink/[0.03]"
    >
      <span className="flex min-w-0 items-center gap-3">
        <LessonThumb completed={completed} className="w-16" />
        <span className="truncate text-ed-15 font-book text-ed-ink-78">
          {name}
        </span>
      </span>
      <span className="shrink-0 font-mono text-ed-12 text-ed-ink/60">
        {formatDuration(duration)}
      </span>
    </Link>
  );
}
