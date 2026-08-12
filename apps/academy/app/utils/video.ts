import { modules } from "~/config";

export function formatDuration(duration: number) {
  const total = Number.isFinite(duration)
    ? Math.max(0, Math.floor(duration))
    : 0;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds
      .toString()
      .padStart(2, "0")}`;
  }

  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/**
 * Pull the video id out of a Loom share/embed URL. Returns null when the URL is
 * missing or doesn't contain a `/share/` or `/embed/` segment, so callers can
 * render a fallback instead of an `embed/undefined` iframe.
 */
export function getLoomEmbedId(loomUrl: string | null | undefined) {
  if (!loomUrl) return null;
  const id = loomUrl.split(/(?:share|embed)\//)[1]?.split("?")[0];
  return id ? id : null;
}

/**
 * A lesson that has no recorded video yet. Placeholder entries carry
 * `duration: 0` (and share a stand-in Loom URL), so they're shown as "coming
 * soon" rather than embedded, and are left out of progress and navigation.
 */
export function isLessonComingSoon(lesson: {
  duration: number;
  loomUrl?: string | null;
}) {
  return lesson.duration <= 0 || getLoomEmbedId(lesson.loomUrl) === null;
}

export function findTopicContext(topicId: string) {
  for (const module of modules) {
    for (const course of module.courses) {
      const topic = course.topics.find(
        (topic: { id: string }) => topic.id === topicId
      );
      if (topic) {
        return {
          module,
          course,
          topic
        };
      }
    }
  }
  return null;
}

export function getLessonContext(lessonId: string) {
  for (const module of modules) {
    for (const course of module.courses) {
      for (const topic of course.topics) {
        // Search in regular lessons
        const lesson = topic.lessons.find(
          (lesson: { id: string }) => lesson.id === lessonId
        );
        if (lesson) {
          return {
            module,
            course,
            topic,
            lesson,
            lessonType: "regular" as const
          };
        }

        // Search in supplemental lessons
        if (topic.supplemental) {
          const supplementalLesson = topic.supplemental.find(
            (lesson: { id: string }) => lesson.id === lessonId
          );
          if (supplementalLesson) {
            return {
              module,
              course,
              topic,
              lesson: supplementalLesson,
              lessonType: "supplemental" as const
            };
          }
        }
      }
    }
  }
  return null;
}

/**
 * The list a lesson is navigated within: the topic's core lessons, or its
 * supplemental videos when the lesson is supplemental. Supplemental lessons are
 * a separate track, so they page through each other rather than the core path.
 */
export function getLessonSiblings(lessonId: string) {
  const context = getLessonContext(lessonId);
  if (!context) return null;

  return context.lessonType === "supplemental"
    ? (context.topic.supplemental ?? [])
    : context.topic.lessons;
}

export function getNextLesson(lessonId: string) {
  const siblings = getLessonSiblings(lessonId);
  if (!siblings) return null;

  const currentIndex = siblings.findIndex((lesson) => lesson.id === lessonId);
  if (currentIndex === -1) return null;

  return (
    siblings
      .slice(currentIndex + 1)
      .find((lesson) => !isLessonComingSoon(lesson)) ?? null
  );
}

export function getPreviousLesson(lessonId: string) {
  const siblings = getLessonSiblings(lessonId);
  if (!siblings) return null;

  const currentIndex = siblings.findIndex((lesson) => lesson.id === lessonId);
  if (currentIndex <= 0) return null;

  return (
    siblings
      .slice(0, currentIndex)
      .reverse()
      .find((lesson) => !isLessonComingSoon(lesson)) ?? null
  );
}
