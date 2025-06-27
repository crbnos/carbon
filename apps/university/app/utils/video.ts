import { sections } from "~/config";

export function formatDuration(duration: number) {
  const minutes = Math.floor(duration / 60);
  const seconds = duration % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function findLessonContext(lessonId: string) {
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

export function findNextLesson(lessonId: string) {
  const context = findLessonContext(lessonId);
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

export function findPreviousLesson(lessonId: string) {
  const context = findLessonContext(lessonId);
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
