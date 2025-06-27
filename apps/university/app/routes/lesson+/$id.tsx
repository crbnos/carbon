import { Button } from "@carbon/react";
import { Link, useParams } from "@remix-run/react";
import {
  LuChevronLeft,
  LuChevronRight,
  LuCirclePlay,
  LuFlag,
} from "react-icons/lu";
import Share from "~/components/Share";
import { path } from "~/utils/path";
import {
  findLessonContext,
  findNextLesson,
  findPreviousLesson,
  formatDuration,
} from "~/utils/video";

export default function LessonRoute() {
  const { id } = useParams();

  if (!id) {
    throw new Error("Lesson ID is required");
  }

  const context = findLessonContext(id);

  if (!context) {
    throw new Error("Lesson not found");
  }

  const { section, course, topic, lesson } = context;
  const nextLesson = findNextLesson(id);
  const previousLesson = findPreviousLesson(id);

  return (
    <div className="w-full px-4 max-w-6xl mx-auto mt-4 pb-24 flex flex-col gap-8">
      <div className="flex items-center gap-2">
        <Button variant="primary" leftIcon={<LuChevronLeft />} asChild>
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
          className="w-full h-12 rounded-b-lg flex items-center justify-end px-3"
          style={{
            backgroundColor: section.background,
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
            className="border rounded rounded-b-none p-4"
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
          <div className="flex flex-col gap-4 border rounded-b border-t-0 px-6 py-4">
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
              {topic.lessons.map((topicLesson) => (
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
                    <LuCirclePlay className="size-4 text-muted-foreground" />
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
              ))}
            </div>
          </div>
          {topic.challenge && (
            <Button
              variant={!nextLesson ? "primary" : "secondary"}
              leftIcon={<LuFlag className="size-4" />}
              asChild
            >
              <Link to={path.to.challenge(topic.id)}>Take Topic Challenge</Link>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
