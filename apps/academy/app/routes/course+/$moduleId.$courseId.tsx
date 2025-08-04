import { Button, cn, Progress, VStack } from "@carbon/react";
import { json, Link, useParams } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import {
  LuCircleCheck,
  LuCirclePlay,
  LuFlag,
  LuRotateCcw,
} from "react-icons/lu";
import { modules } from "~/config";
import { useProgress } from "~/hooks";
import { path } from "~/utils/path";
import { formatDuration } from "~/utils/video";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { courseId } = params;

  if (!courseId) {
    throw new Error("Course ID is required");
  }

  return json({});
};

export default function CourseRoute() {
  const { lessonCompletions, challengeAttempts } = useProgress();

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

  if (!course) {
    throw new Error("Course not found");
  }

  // Filter data for current course
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

  const completionPercentage = Math.min(
    Math.round((completedChallenges.length / totalChallenges) * 100),
    100
  );

  return (
    <VStack spacing={4} className="w-full">
      <div className="flex flex-col w-full">
        <div
          className="border rounded-lg rounded-b-none px-8 py-3"
          style={{
            backgroundColor: module?.background,
            color: module?.foreground,
          }}
        >
          <div className="flex flex-col items-start">
            <span className="text-[10px] uppercase font-display font-bold opacity-80">
              Section
            </span>
            <span className="uppercase text-sm font-display font-bold">
              {module?.name}
            </span>
          </div>
        </div>
        <div className="border border-b-0 border-t-0 p-8">
          <div className="flex flex-col gap-4">
            <div className="flex items-start gap-4">
              <div
                className="flex-shrink-0 size-12 text-2xl p-3 rounded-lg"
                style={{
                  backgroundColor: module?.background,
                  color: module?.foreground,
                }}
              >
                {course.icon}
              </div>
              <div className="flex flex-col">
                <h1 className="uppercase text-[10px] font-display font-bold text-muted-foreground">
                  Course
                </h1>
                <h2 className="text-2xl font-display tracking-tight">
                  {course.name}
                </h2>
              </div>
            </div>
            <p className="text-sm">{course.description}</p>
          </div>
        </div>
        <div className="border rounded-lg rounded-t-none px-8 py-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-4 text-xs">
              <div className="flex items-center gap-1">
                <span className="font-bold">Length:</span>
                <span className="text-muted-foreground">
                  {formatDuration(totalDuration)}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <span className="font-bold">Challenges:</span>
                <span className="text-muted-foreground">{totalChallenges}</span>
              </div>
            </div>
            <div className="flex items-center gap-1 text-xs">
              <span className="font-bold text-emerald-500">
                {completionPercentage}%
              </span>
              <Progress value={completionPercentage} />
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-col w-full">
        {course.topics.map((topic, index) => {
          const hasChallenge = topic.challenge && topic.challenge.length > 0;
          const isChallengeCompleted =
            hasChallenge && completedChallenges.includes(topic.id);
          const isChallengeAttempted =
            hasChallenge && attemptsByTopic[topic.id];
          const challengeAttempts = attemptsByTopic[topic.id] ?? 0;
          const isFirst = index === 0;
          const isLast = index === course.topics.length - 1;
          return (
            <div
              key={topic.id}
              className={cn(
                "border p-8 w-full",
                isFirst && "rounded-t-lg",
                isLast && "rounded-b-lg",
                isFirst && !isLast && "rounded-b-none",
                isLast && !isFirst && "border-t-0 rounded-t-none"
              )}
            >
              <div className="grid grid-cols-2 gap-12">
                <div className="flex flex-col gap-1">
                  <h3 className="text-[10px] uppercase font-display font-bold text-muted-foreground">
                    Topic
                  </h3>
                  <h2 className="text-xl font-display tracking-tight">
                    {topic.name}
                  </h2>
                  <p className="text-sm">{topic.description}</p>
                </div>
                <div className="flex flex-col gap-4 py-8 w-full text-sm">
                  <div className="flex flex-col gap-0">
                    {topic.lessons.map((lesson) => {
                      const isCompleted = completedLessons.includes(lesson.id);
                      return (
                        <Link
                          key={lesson.id}
                          to={path.to.lesson(lesson.id)}
                          className="flex items-center justify-between gap-2 w-full rounded-md py-1.5 px-3 hover:bg-accent"
                        >
                          <div className="flex items-center gap-2">
                            {isCompleted ? (
                              <LuCircleCheck className="size-4 flex-shrink-0 text-emerald-500" />
                            ) : (
                              <LuCirclePlay className="size-4 flex-shrink-0 text-muted-foreground" />
                            )}
                            <span>{lesson.name}</span>
                          </div>
                          <span className="text-muted-foreground text-xs">
                            {formatDuration(lesson.duration)}
                          </span>
                        </Link>
                      );
                    })}
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
                        leftIcon={
                          isChallengeAttempted ? <LuRotateCcw /> : <LuFlag />
                        }
                        asChild
                      >
                        <Link to={path.to.challenge(topic.id)}>
                          {isChallengeAttempted ? (
                            <span>
                              Retake Topic Challenge{" "}
                              <span className="text-xs text-muted-foreground italic">
                                {challengeAttempts} attempt
                                {challengeAttempts === 1 ? "" : "s"} made
                              </span>
                            </span>
                          ) : (
                            "Take Topic Challenge"
                          )}
                        </Link>
                      </Button>
                    )
                  ) : null}
                  {topic.supplemental && topic.supplemental.length > 0 && (
                    <div className="flex flex-col gap-0">
                      <h3 className="text-[10px] uppercase font-display font-bold text-muted-foreground">
                        Supplemental Videos
                      </h3>
                      {topic.supplemental?.map((lesson) => {
                        const isCompleted = completedLessons.includes(
                          lesson.id
                        );
                        return (
                          <Link
                            key={lesson.id}
                            to={path.to.lesson(lesson.id)}
                            className="flex items-center justify-between gap-2 w-full rounded-md py-1.5 px-3 hover:bg-accent"
                          >
                            <div className="flex items-center gap-2">
                              {isCompleted ? (
                                <LuCircleCheck className="size-4 flex-shrink-0 text-emerald-500" />
                              ) : (
                                <LuCirclePlay className="size-4 flex-shrink-0 text-muted-foreground" />
                              )}
                              <span>{lesson.name}</span>
                            </div>
                            <span className="text-muted-foreground text-xs">
                              {formatDuration(lesson.duration)}
                            </span>
                          </Link>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </VStack>
  );
}
