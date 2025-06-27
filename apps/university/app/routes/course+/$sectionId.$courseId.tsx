import { Button, cn, Progress, VStack } from "@carbon/react";
import { Link, useParams } from "@remix-run/react";
import { LuCirclePlay, LuFlag } from "react-icons/lu";
import { sections } from "~/config";
import { path } from "~/utils/path";
import { formatDuration } from "~/utils/video";

export default function CourseRoute() {
  const { sectionId, courseId } = useParams();
  const section = sections.find((section) => section.id === sectionId);
  const course = section?.courses.find((course) => course.id === courseId);

  const totalDuration =
    course?.topics.reduce((acc, topic) => {
      return acc + topic.videos.reduce((acc, video) => acc + video.duration, 0);
    }, 0) ?? 0;

  const totalChallenges =
    course?.topics.reduce((acc, topic) => {
      return acc + (topic.challenge === undefined ? 0 : 1);
    }, 0) ?? 0;

  if (!course) {
    throw new Error("Course not found");
  }

  return (
    <VStack spacing={4}>
      <div className="flex flex-col">
        <div
          className="border rounded rounded-b-none px-8 py-3"
          style={{
            backgroundColor: section?.background,
            color: section?.foreground,
          }}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="uppercase text-sm font-display font-bold">
              {section?.name}
            </span>
          </div>
        </div>
        <div className="border border-b-0 border-t-0 p-8">
          <div className="flex flex-col gap-4">
            <div className="flex items-start gap-4">
              <div
                className="flex-shrink-0 size-12 text-2xl p-3 rounded-full"
                style={{
                  backgroundColor: section?.background,
                  color: section?.foreground,
                }}
              >
                {section?.icon}
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
        <div className="border rounded rounded-t-none px-8 py-3">
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
              <span className="font-bold text-emerald-500">0%</span>
              <Progress value={0} />
            </div>
          </div>
        </div>
      </div>

      {course.topics.map((topic, index) => {
        const isFirst = index === 0;
        const isLast = index === course.topics.length - 1;
        return (
          <div
            key={topic.id}
            className={cn(
              "border p-8 w-full",
              isFirst && "rounded-t",
              isLast && "rounded-b",
              isFirst && !isLast && "border-b-0 rounded-b-none",
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
              <div className="flex flex-col gap-8 py-8 w-full text-sm">
                <div className="flex flex-col gap-0">
                  {topic.videos.map((video) => (
                    <Link
                      key={video.id}
                      to={path.to.video(video.id)}
                      className="flex items-center justify-between gap-2 w-full rounded-md py-1.5 px-3 hover:bg-accent"
                    >
                      <div className="flex items-center gap-2">
                        <LuCirclePlay className="size-4 text-muted-foreground" />
                        <span>{video.name}</span>
                      </div>
                      <span className="text-muted-foreground text-xs">
                        {formatDuration(video.duration)}
                      </span>
                    </Link>
                  ))}
                </div>
                {topic.challenge && (
                  <Button
                    leftIcon={<LuFlag className="size-4" />}
                    variant="secondary"
                  >
                    Take Topic Challenge
                  </Button>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </VStack>
  );
}
