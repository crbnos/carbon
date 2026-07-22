import { getCarbon } from "@carbon/auth";
import { getOrRefreshAuthSession } from "@carbon/auth/session.server";
import { getLogger } from "@carbon/logger";
import { Spinner } from "@carbon/react";
import { useEffect } from "react";
import { LuCircleCheck, LuFlag } from "react-icons/lu";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, Link, useFetcher, useParams } from "react-router";
import { Breadcrumb } from "~/components/Breadcrumb";
import { ChapterCard } from "~/components/ChapterCard";
import { GlossaryText } from "~/components/GlossaryText";
import { LearnShell } from "~/components/LearnShell";
import { LessonThumb } from "~/components/LessonThumb";
import Share from "~/components/Share";
import { useProgress } from "~/hooks";
import { path } from "~/utils/path";
import {
  formatDuration,
  getLessonContext,
  getNextLesson,
  getPreviousLesson
} from "~/utils/video";

const log = getLogger("academy");

export const loader = async ({ params }: LoaderFunctionArgs) => {
  const { id: lessonId } = params;

  if (!lessonId) {
    throw new Error("Lesson ID is required");
  }
  const context = getLessonContext(lessonId);

  if (!context) {
    throw new Error("Lesson not found");
  }

  return {};
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { id: lessonId } = params;

  if (!lessonId) {
    return data(
      { success: false, message: "Lesson ID is required" },
      { status: 400 }
    );
  }

  const context = getLessonContext(lessonId);
  if (!context) {
    return data(
      { success: false, message: "Lesson not found" },
      { status: 404 }
    );
  }

  // Check if user is authenticated
  const session = await getOrRefreshAuthSession(request);
  if (!session) {
    return data(
      { success: false, message: "Authentication required" },
      { status: 401 }
    );
  }

  const { course } = context;
  const client = getCarbon(session.accessToken);

  const insert = await client.from("lessonCompletion").insert({
    userId: session.userId,
    courseId: course.id,
    lessonId
  });

  if (insert.error) {
    return data(
      { success: false, message: "Failed to complete lesson" },
      { status: 500 }
    );
  }

  return { success: true };
};

export default function LessonRoute() {
  const { lessonCompletions, challengeAttempts } = useProgress();
  const { id } = useParams();
  const fetcher = useFetcher<typeof action>();

  if (!id) {
    throw new Error("Lesson ID is required");
  }

  const context = getLessonContext(id);

  if (!context) {
    throw new Error("Lesson not found");
  }

  const { module, course, topic, lesson } = context;
  const nextLesson = getNextLesson(id);
  const previousLesson = getPreviousLesson(id);
  const hasChallenge = topic.challenge && topic.challenge.length > 0;

  const completedLessons = lessonCompletions
    .filter((completion) => completion.courseId === course.id)
    .map((completion) => completion.lessonId);

  const completedChallenges = challengeAttempts
    .filter((attempt) => attempt.courseId === course.id && attempt.passed)
    .map((attempt) => attempt.topicId);

  const attemptsByTopic = challengeAttempts
    .filter((attempt) => attempt.courseId === course.id)
    .reduce<Record<string, number>>((acc, attempt) => {
      acc[attempt.topicId] = (acc[attempt.topicId] ?? 0) + 1;
      return acc;
    }, {});

  const isChallengeCompleted =
    hasChallenge && completedChallenges.includes(topic.id);
  const isChallengeAttempted = hasChallenge && attemptsByTopic[topic.id];
  const challengeAttemptCount = attemptsByTopic[topic.id] ?? 0;

  const onComplete = () => {
    fetcher.submit(null, {
      method: "POST",
      action: path.to.lesson(id)
    });
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        if (data.event === "ready" && data.context === "player.js") {
          const iframe = document.getElementById(
            "loom-embed"
          ) as HTMLIFrameElement;
          if (iframe) {
            iframe.contentWindow?.postMessage(
              JSON.stringify({
                method: "addEventListener",
                value: "ended",
                context: "player.js"
              }),
              "*"
            );
          }
        }

        if (data.event === "ended" && data.context === "player.js") {
          onComplete();
        }
      } catch (error) {
        log.error("Error parsing message data", { error });
      }
    };

    window.addEventListener("message", handleMessage);

    return () => {
      window.removeEventListener("message", handleMessage);
    };
  }, [id]);

  return (
    <LearnShell activeCourseId={course.id}>
      <div className="grid grid-cols-1 gap-10 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0">
          <Breadcrumb
            items={[
              { label: "Courses", href: path.to.root },
              {
                label: course.name,
                href: path.to.course(module.id, course.id)
              },
              { label: topic.name }
            ]}
          />

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <span
              className="inline-flex items-center justify-center whitespace-nowrap rounded-full px-2 py-1 font-mono text-ed-12 font-medium leading-4 uppercase tracking-[0.06em] text-ed-ink/72"
              style={{
                background:
                  "linear-gradient(180deg, rgba(251, 251, 248, 0.50) 0%, rgba(251, 251, 248, 0.00) 100%)",
                boxShadow:
                  "0 0 0 1px #FFF inset, 0 0 0 1px rgba(0, 0, 0, 0.12), 0 2px 2px 0 rgba(0, 0, 0, 0.02)"
              }}
            >
              Lesson — {topic.name}
            </span>
            <span className="inline-flex items-center gap-[5px] font-mono text-ed-12 leading-4 text-ed-ink/42">
              <ClockIcon />
              {formatDuration(lesson.duration)}
            </span>
          </div>

          <h1 className="mt-[18px] text-ed-32 font-normal leading-[112%] text-ink md:text-ed-40">
            {lesson.name}
          </h1>

          <div className="mt-6 overflow-hidden rounded-xl border border-ed-hairline bg-black shadow-[inset_0_1px_0_#fff]">
            <div
              style={{
                position: "relative",
                paddingBottom: "56.25%",
                height: "0"
              }}
            >
              <div className="absolute inset-0 flex items-center justify-center">
                <Spinner className="h-8 w-8 text-white/70" />
              </div>
              <iframe
                key={id}
                id="loom-embed"
                title={lesson.name}
                src={`https://www.loom.com/embed/${
                  lesson.loomUrl.split(/(?:share|embed)\//)[1]?.split("?")[0]
                }?hideEmbedTopBar=true`}
                allowFullScreen
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  height: "100%"
                }}
              />
            </div>
          </div>

          <div className="mt-3 flex items-center justify-end">
            <Share
              text={typeof window !== "undefined" ? window.location.href : ""}
            />
          </div>

          <div className="guide-prose mt-8 max-w-2xl">
            <h2 className="text-ed-16 font-demi text-ed-ink">
              About this lesson
            </h2>
            <p className="mt-2">
              <GlossaryText>{lesson.description}</GlossaryText>
            </p>
          </div>
        </div>

        {/* Right rail */}
        <div className="flex flex-col gap-6 xl:sticky xl:top-24 xl:self-start">
          {(previousLesson || nextLesson) && (
            <div className="flex flex-col gap-3">
              {previousLesson && (
                <ChapterCard
                  dir="prev"
                  title={previousLesson.name}
                  to={path.to.lesson(previousLesson.id)}
                />
              )}
              {nextLesson && (
                <ChapterCard
                  dir="next"
                  title={nextLesson.name}
                  to={path.to.lesson(nextLesson.id)}
                />
              )}
            </div>
          )}

          <div>
            <p className="mb-2 px-1 font-mono text-ed-11 font-semibold uppercase tracking-[0.08em] text-ed-ink/50">
              Lessons in this topic
            </p>
            <div className="flex flex-col gap-0.5">
              {topic.lessons.map((topicLesson) => {
                const isCompleted = completedLessons.includes(topicLesson.id);
                const isCurrent = topicLesson.id === lesson.id;
                return (
                  <Link
                    key={topicLesson.id}
                    to={path.to.lesson(topicLesson.id)}
                    className={`flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-ed-15 no-underline transition-colors ${
                      isCurrent
                        ? "bg-ed-accent-fill font-demi text-ed-blue-text"
                        : "font-book text-ed-ink-78 hover:bg-ed-ink/[0.04]"
                    }`}
                  >
                    <span className="flex min-w-0 items-center gap-2.5">
                      <LessonThumb completed={isCompleted} className="w-12" />
                      <span className="truncate">{topicLesson.name}</span>
                    </span>
                    <span className="shrink-0 font-mono text-ed-11 text-ed-ink/40">
                      {formatDuration(topicLesson.duration)}
                    </span>
                  </Link>
                );
              })}
            </div>
          </div>

          {hasChallenge ? (
            isChallengeCompleted ? (
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
                  <LuFlag className="size-3.5" />
                  {isChallengeAttempted
                    ? `Retake challenge (${challengeAttemptCount})`
                    : "Take topic challenge"}
                </span>
              </Link>
            )
          ) : null}
        </div>
      </div>
    </LearnShell>
  );
}

function ClockIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 14 14"
      fill="none"
      aria-hidden="true"
      className="shrink-0"
    >
      <circle
        cx="7"
        cy="7"
        r="5.25"
        stroke="rgba(38,35,35,0.42)"
        strokeWidth="1.2"
      />
      <path
        d="M7 4.2V7l1.9 1.15"
        stroke="rgba(38,35,35,0.42)"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
