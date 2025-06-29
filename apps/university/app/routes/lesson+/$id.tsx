import { requirePermissions } from "@carbon/auth/auth.server";
import { Button } from "@carbon/react";
import {
  json,
  Link,
  useFetcher,
  useLoaderData,
  useParams,
} from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import {
  LuCheck,
  LuChevronLeft,
  LuChevronRight,
  LuCircleCheck,
  LuCirclePlay,
  LuFlag,
} from "react-icons/lu";
import Share from "~/components/Share";
import { path } from "~/utils/path";
import {
  formatDuration,
  getLessonContext,
  getNextLesson,
  getPreviousLesson,
} from "~/utils/video";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { client, userId } = await requirePermissions(request, {});
  const { id: lessonId } = params;

  if (!lessonId) {
    throw new Error("Lesson ID is required");
  }
  const context = getLessonContext(lessonId);

  if (!context) {
    throw new Error("Lesson not found");
  }

  const { course, topic } = context;

  const [lessonCompletions, challengeAttempts] = await Promise.all([
    client
      .from("lessonCompletion")
      .select("lessonId")
      .eq("userId", userId)
      .eq("courseId", course.id),
    client
      .from("challengeAttempt")
      .select("topicId, passed")
      .eq("userId", userId)
      .eq("topicId", topic.id),
  ]);

  const completedLessons =
    lessonCompletions.data?.map((completion) => completion.lessonId) ?? [];
  const completedChallenges =
    challengeAttempts.data
      ?.filter((completion) => completion.passed)
      .map((completion) => completion.topicId) ?? [];
  const attemptsByTopic =
    challengeAttempts.data?.reduce<Record<string, number>>(
      (acc, completion) => {
        acc[completion.topicId] = (acc[completion.topicId] ?? 0) + 1;
        return acc;
      },
      {}
    ) ?? {};

  return json({ completedLessons, completedChallenges, attemptsByTopic });
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { client, userId } = await requirePermissions(request, {});
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
  const { course } = context;

  const insert = await client.from("lessonCompletion").insert({
    userId,
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
  const { completedLessons, completedChallenges, attemptsByTopic } =
    useLoaderData<typeof loader>();
  const { id } = useParams();

  if (!id) {
    throw new Error("Lesson ID is required");
  }

  const context = getLessonContext(id);

  if (!context) {
    throw new Error("Lesson not found");
  }

  const { section, course, topic, lesson } = context;
  const nextLesson = getNextLesson(id);
  const previousLesson = getPreviousLesson(id);
  const hasChallenge = topic.challenge && topic.challenge.length > 0;
  const isChallengeCompleted =
    hasChallenge && completedChallenges.includes(topic.id);
  const isChallengeAttempted = hasChallenge && attemptsByTopic[topic.id];
  const challengeAttempts = attemptsByTopic[topic.id] ?? 0;

  const fetcher = useFetcher<typeof action>();

  const onComplete = async () => {
    fetcher.submit(null, {
      method: "POST",
      action: path.to.lesson(id),
    });
  };

  return (
    <div className="w-full px-4 max-w-5xl mx-auto mt-4 pb-24 flex flex-col gap-8">
      <div className="flex items-center gap-2">
        <Button
          variant="primary"
          leftIcon={<LuChevronLeft />}
          className="mr-2"
          asChild
        >
          <Link to={path.to.course(section.id, course.id)}>Back to course</Link>
        </Button>

        <Button
          variant="link"
          className="text-sm text-muted-foreground"
          asChild
        >
          <Link to={path.to.course(section.id, course.id)}>{course.name}</Link>
        </Button>

        <span className="text-muted-foreground text-sm">/</span>

        <span className="text-muted-foreground text-sm font-bold">
          {topic.name}
        </span>
      </div>

      <div className="flex flex-col w-full">
        <div className="w-full aspect-video bg-black rounded-t-lg overflow-hidden">
          <iframe
            src={`https://player.vimeo.com/video/${lesson.videoId}?h=00000000&badge=0&autopause=0&player_id=0&app_id=58479`}
            allow="autoplay; fullscreen; picture-in-picture"
            className="w-full h-full"
            title={lesson.name}
          />
        </div>
        <div
          className="w-full h-12 rounded-b-lg flex items-center justify-end gap-2 px-3"
          style={{
            backgroundColor: section.background,
          }}
        >
          <Button
            variant="secondary"
            leftIcon={<LuCheck className="size-4" />}
            onClick={onComplete}
            isDisabled={fetcher.state !== "idle"}
            isLoading={fetcher.state !== "idle"}
          >
            Complete Lesson
          </Button>
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
              backgroundColor: section?.background,
              color: section?.foreground,
            }}
          >
            <div className="flex flex-col gap-4">
              <div className="flex items-start gap-4">
                <div
                  className="flex-shrink-0 size-12 text-2xl p-3 rounded-full border"
                  style={{
                    backgroundColor: section?.background,
                    borderColor: section?.foreground,
                    color: section?.foreground,
                  }}
                >
                  {section?.icon}
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
                        <LuCircleCheck className="size-4 text-emerald-500" />
                      ) : (
                        <LuCirclePlay className="size-4 text-muted-foreground" />
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
                leftIcon={<LuCircleCheck className="size-4 text-emerald-500" />}
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
                    ? `Retake Topic Challenge (${challengeAttempts} attempt${
                        challengeAttempts === 1 ? "" : "s"
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
