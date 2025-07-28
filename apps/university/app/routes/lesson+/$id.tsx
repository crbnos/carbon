import { getCarbon } from "@carbon/auth";
import { getOrRefreshAuthSession } from "@carbon/auth/session.server";
import { Button, Spinner } from "@carbon/react";
import { json, Link, useFetcher, useParams } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { useEffect } from "react";
import {
  LuChevronLeft,
  LuChevronRight,
  LuCircleCheck,
  LuCirclePlay,
  LuFlag,
} from "react-icons/lu";
import Share from "~/components/Share";
import { useProgress } from "~/hooks";
import { path } from "~/utils/path";
import {
  formatDuration,
  getLessonContext,
  getNextLesson,
  getPreviousLesson,
} from "~/utils/video";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { id: lessonId } = params;

  if (!lessonId) {
    throw new Error("Lesson ID is required");
  }
  const context = getLessonContext(lessonId);

  if (!context) {
    throw new Error("Lesson not found");
  }

  return json({});
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { id: lessonId } = params;

  if (!lessonId) {
    return json(
      { success: false, message: "Lesson ID is required" },
      { status: 400 }
    );
  }

  const context = getLessonContext(lessonId);
  if (!context) {
    return json(
      { success: false, message: "Lesson not found" },
      { status: 404 }
    );
  }

  // Check if user is authenticated
  const session = await getOrRefreshAuthSession(request);
  if (!session) {
    return json(
      { success: false, message: "Authentication required" },
      { status: 401 }
    );
  }

  const { course } = context;
  const client = getCarbon(session.accessToken);

  const insert = await client.from("lessonCompletion").insert({
    userId: session.userId,
    courseId: course.id,
    lessonId,
  });

  if (insert.error) {
    return json(
      { success: false, message: "Failed to complete lesson" },
      { status: 500 }
    );
  }

  return json({ success: true });
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

  // Filter data for current course/topic
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

  const onComplete = async (lessonId: string) => {
    fetcher.submit(null, {
      method: "POST",
      action: path.to.lesson(id),
    });
  };

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
                context: "player.js",
              }),
              "*"
            );
          }
        }

        if (data.event === "ended" && data.context === "player.js") {
          onComplete(id);
        }
      } catch (error) {
        console.error("Error parsing message data", error);
      }
    };

    window.addEventListener("message", handleMessage);

    return () => {
      window.removeEventListener("message", handleMessage);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  return (
    <div className="w-full px-4 max-w-5xl mx-auto mt-4 pb-24 flex flex-col gap-8">
      <div className="flex items-center gap-2">
        <Button
          variant="primary"
          leftIcon={<LuChevronLeft />}
          className="mr-2"
          asChild
        >
          <Link to={path.to.course(module.id, course.id)}>Back to course</Link>
        </Button>

        <Button
          variant="link"
          className="text-sm text-muted-foreground"
          asChild
        >
          <Link to={path.to.course(module.id, course.id)}>{course.name}</Link>
        </Button>

        <span className="text-muted-foreground text-sm">/</span>

        <span className="text-muted-foreground text-sm font-bold">
          {topic.name}
        </span>
      </div>

      <div className="flex flex-col w-full">
        <div className="w-full aspect-video bg-black rounded-t-lg overflow-hidden">
          <div
            style={{
              position: "relative",
              paddingBottom: "56.25%",
              height: "0",
            }}
          >
            <div className="absolute inset-0 flex items-center justify-center">
              <Spinner className="h-8 w-8" />
            </div>
            <iframe
              key={id}
              id="loom-embed"
              title={lesson.name}
              src={`https://www.loom.com/embed/${
                lesson.loomUrl.split("share/")[1]
              }&hideEmbedTopBar=true`}
              allowFullScreen
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: "100%",
              }}
            />
          </div>
        </div>
        <div
          className="dark w-full h-12 rounded-b-lg flex items-center justify-end gap-2 px-3"
          style={{
            backgroundColor: module.background,
          }}
        >
          <Share
            text={typeof window !== "undefined" ? window.location.href : ""}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[1fr_360px] gap-6">
        <div className="flex flex-col w-full">
          <div
            className="border rounded-lg rounded-b-none p-4"
            style={{
              backgroundColor: module?.background,
              color: module?.foreground,
            }}
          >
            <div className="flex flex-col gap-4">
              <div className="flex items-start gap-4">
                <div
                  className="flex-shrink-0 size-12 text-2xl p-3 rounded-lg bg-black/20"
                  style={{
                    color: module?.foreground,
                  }}
                >
                  {course.icon}
                </div>
                <div className="flex flex-col">
                  <h1 className="uppercase text-[10px] font-display font-bold">
                    Lesson
                  </h1>
                  <h2 className="text-2xl font-display tracking-tight">
                    {lesson.name}
                  </h2>
                </div>
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-4 border rounded-b-lg border-t-0 px-6 py-4">
            <h4 className="text-lg font-display font-bold">Description</h4>
            <p className="text-base text-muted-foreground">
              {lesson.description}
            </p>
          </div>
        </div>

        {/* Right Sidebar */}
        <div className="flex flex-col gap-4">
          {/* Navigation Buttons */}
          <div className="flex gap-2">
            <Button
              variant="secondary"
              leftIcon={<LuChevronLeft className="size-4" />}
              disabled={!previousLesson}
              asChild={!!previousLesson}
              className={!previousLesson ? "opacity-50 cursor-not-allowed" : ""}
            >
              {previousLesson ? (
                <Link to={path.to.lesson(previousLesson.id)}>
                  Previous Lesson
                </Link>
              ) : (
                <span>Previous Lesson</span>
              )}
            </Button>

            <Button
              variant={!nextLesson ? "secondary" : "primary"}
              rightIcon={<LuChevronRight className="size-4" />}
              disabled={!nextLesson}
              asChild={!!nextLesson}
              className={!nextLesson ? "opacity-50 cursor-not-allowed" : ""}
            >
              {nextLesson ? (
                <Link to={path.to.lesson(nextLesson.id)}>Next Lesson</Link>
              ) : (
                <span>Next Lesson</span>
              )}
            </Button>
          </div>

          {/* Lesson List */}
          <div className="border rounded-lg p-4">
            <h3 className="text-sm font-display font-bold text-muted-foreground mb-3">
              Lessons in this topic
            </h3>
            <div className="flex flex-col gap-1">
              {topic.lessons.map((topicLesson) => {
                const isCompleted = completedLessons.includes(topicLesson.id);

                return (
                  <Link
                    key={topicLesson.id}
                    to={path.to.lesson(topicLesson.id)}
                    className={`flex items-center justify-between gap-2 w-full rounded-md py-2 px-3 text-sm transition-colors ${
                      topicLesson.id === lesson.id
                        ? "bg-accent text-accent-foreground"
                        : "hover:bg-accent"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {isCompleted ? (
                        <LuCircleCheck className="size-4 flex-shrink-0 text-emerald-500" />
                      ) : (
                        <LuCirclePlay className="size-4 flex-shrink-0 text-muted-foreground" />
                      )}
                      <span
                        className={
                          topicLesson.id === lesson.id ? "font-medium" : ""
                        }
                      >
                        {topicLesson.name}
                      </span>
                    </div>
                    <span className="text-muted-foreground text-xs">
                      {formatDuration(topicLesson.duration)}
                    </span>
                  </Link>
                );
              })}
            </div>
          </div>
          {hasChallenge ? (
            isChallengeCompleted ? (
              <Button
                variant="primary"
                leftIcon={
                  <LuCircleCheck className="size-4 flex-shrink-0 text-emerald-500" />
                }
              >
                Topic Challenge Completed
              </Button>
            ) : (
              <Button
                variant="secondary"
                leftIcon={<LuFlag className="size-4" />}
                asChild
              >
                <Link to={path.to.challenge(topic.id)}>
                  {isChallengeAttempted
                    ? `Retake Topic Challenge (${challengeAttemptCount} attempt${
                        challengeAttemptCount === 1 ? "" : "s"
                      })`
                    : "Take Topic Challenge"}
                </Link>
              </Button>
            )
          ) : null}
        </div>
      </div>
    </div>
  );
}
