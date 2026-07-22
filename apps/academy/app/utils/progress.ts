import { modules } from "~/config";

type Module = (typeof modules)[number];
type Course = Module["courses"][number];
type Topic = Course["topics"][number];
type Lesson = Topic["lessons"][number];

export type CourseProgress = {
  lessonsDone: number;
  lessonsTotal: number;
  challengesDone: number;
  challengesTotal: number;
  /** Combined completion across core lessons + challenges, 0–100. */
  percent: number;
  complete: boolean;
};

export type ResumeTarget = {
  module: Module;
  course: Course;
  topic: Topic;
  lesson: Lesson;
};

/** Core lessons in a topic (supplemental videos are extra, excluded from the path). */
function topicChallengeCount(topic: Topic): number {
  return topic.challenge && topic.challenge.length > 0 ? 1 : 0;
}

export function getCourseProgress(
  course: Course,
  completedLessonIds: Set<string>,
  passedTopicIds: Set<string>
): CourseProgress {
  let lessonsDone = 0;
  let lessonsTotal = 0;
  let challengesDone = 0;
  let challengesTotal = 0;

  for (const topic of course.topics) {
    for (const lesson of topic.lessons) {
      lessonsTotal += 1;
      if (completedLessonIds.has(lesson.id)) lessonsDone += 1;
    }
    const hasChallenge = topicChallengeCount(topic) > 0;
    if (hasChallenge) {
      challengesTotal += 1;
      if (passedTopicIds.has(topic.id)) challengesDone += 1;
    }
  }

  const total = lessonsTotal + challengesTotal;
  const done = lessonsDone + challengesDone;
  const percent = total === 0 ? 0 : Math.round((done / total) * 100);

  return {
    lessonsDone,
    lessonsTotal,
    challengesDone,
    challengesTotal,
    percent,
    complete: total > 0 && done >= total
  };
}

export function getOverallProgress(
  completedLessonIds: Set<string>,
  passedTopicIds: Set<string>
): { percent: number; done: number; total: number } {
  let done = 0;
  let total = 0;
  for (const module of modules) {
    for (const course of module.courses) {
      const p = getCourseProgress(course, completedLessonIds, passedTopicIds);
      done += p.lessonsDone + p.challengesDone;
      total += p.lessonsTotal + p.challengesTotal;
    }
  }
  return {
    total,
    done,
    percent: total === 0 ? 0 : Math.round((done / total) * 100)
  };
}

/**
 * Next core lesson to watch, in recommended order (module → course → topic →
 * lesson). Returns the first lesson not in `completedLessonIds`, or null when
 * every core lesson is done.
 */
export function getResumeLesson(
  completedLessonIds: Set<string>
): ResumeTarget | null {
  for (const module of modules) {
    for (const course of module.courses) {
      for (const topic of course.topics) {
        for (const lesson of topic.lessons) {
          if (!completedLessonIds.has(lesson.id)) {
            return { module, course, topic, lesson };
          }
        }
      }
    }
  }
  return null;
}

/** Next incomplete lesson within a single course (for a per-course "Continue"). */
export function getNextLessonInCourse(
  course: Course,
  completedLessonIds: Set<string>
): Lesson | null {
  for (const topic of course.topics) {
    for (const lesson of topic.lessons) {
      if (!completedLessonIds.has(lesson.id)) return lesson;
    }
  }
  return null;
}

/** Build the completed-lesson + passed-topic sets from raw progress arrays. */
export function toProgressSets(
  lessonCompletions: { lessonId: string }[],
  challengeAttempts: { topicId: string; passed: boolean }[]
): { completedLessonIds: Set<string>; passedTopicIds: Set<string> } {
  return {
    completedLessonIds: new Set(lessonCompletions.map((c) => c.lessonId)),
    passedTopicIds: new Set(
      challengeAttempts.filter((a) => a.passed).map((a) => a.topicId)
    )
  };
}
