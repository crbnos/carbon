import { modules } from "~/config";

export function formatDuration(duration: number) {
  const minutes = Math.floor(duration / 60);
  const seconds = duration % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
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
          topic,
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
            lessonType: "regular" as const,
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
              lessonType: "supplemental" as const,
            };
          }
        }
      }
    }
  }
  return null;
}

export function getNextLesson(lessonId: string) {
  const context = getLessonContext(lessonId);
  if (!context) return null;

  const { topic } = context;
  const allLessons = topic.lessons;
  const currentIndex = allLessons.findIndex((lesson) => lesson.id === lessonId);

  if (currentIndex === -1 || currentIndex === allLessons.length - 1) {
    return null;
  }

  return allLessons[currentIndex + 1];
}

export function getPreviousLesson(lessonId: string) {
  const context = getLessonContext(lessonId);
  if (!context) return null;

  const { topic } = context;
  const allLessons = topic.lessons;
  const currentIndex = allLessons.findIndex((lesson) => lesson.id === lessonId);

  if (currentIndex <= 0) {
    return null;
  }

  return allLessons[currentIndex - 1];
}
