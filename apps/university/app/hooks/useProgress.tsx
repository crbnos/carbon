import { useRouteData } from "@carbon/remix";
import { path } from "~/utils/path";

interface LessonCompletion {
  lessonId: string;
  courseId: string;
}

interface ChallengeAttempt {
  topicId: string;
  courseId: string;
  passed: boolean;
}

interface ProgressData {
  lessonCompletions: LessonCompletion[];
  challengeAttempts: ChallengeAttempt[];
}

function isProgressData(value: any): value is ProgressData {
  return (
    Array.isArray(value?.lessonCompletions) &&
    Array.isArray(value?.challengeAttempts)
  );
}

export function useProgress(): ProgressData {
  const data = useRouteData<{
    lessonCompletions: unknown;
    challengeAttempts: unknown;
  }>(path.to.root);

  if (data && isProgressData(data)) {
    return data;
  }

  // Return empty arrays if no data or user not authenticated
  return {
    lessonCompletions: [],
    challengeAttempts: [],
  };
}
