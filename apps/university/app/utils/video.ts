import { sections } from "~/config";

export function formatDuration(duration: number) {
  const minutes = Math.floor(duration / 60);
  const seconds = duration % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function findTopicContext(topicId: string) {
  for (const section of sections) {
    for (const course of section.courses) {
      const topic = course.topics.find(
        (topic: { id: string }) => topic.id === topicId
      );
      if (topic) {
        return {
          section,
          course,
          topic,
        };
      }
    }
  }
  return null;
}

export function getLessonContext(lessonId: string) {
  for (const section of sections) {
    for (const course of section.courses) {
      for (const topic of course.topics) {
        const lesson = topic.lessons.find(
          (lesson: { id: string }) => lesson.id === lessonId
        );
        if (lesson) {
          return {
            section,
            course,
            topic,
            lesson,
          };
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
  const currentIndex = topic.lessons.findIndex(
    (lesson) => lesson.id === lessonId
  );

  if (currentIndex === -1 || currentIndex === topic.lessons.length - 1) {
    return null;
  }

  return topic.lessons[currentIndex + 1];
}

export function getPreviousLesson(lessonId: string) {
  const context = getLessonContext(lessonId);
  if (!context) return null;

  const { topic } = context;
  const currentIndex = topic.lessons.findIndex(
    (lesson) => lesson.id === lessonId
  );

  if (currentIndex <= 0) {
    return null;
  }

  return topic.lessons[currentIndex - 1];
}
