import { requirePermissions } from "@carbon/auth/auth.server";
import { Alert, AlertDescription, AlertTitle, Button, cn } from "@carbon/react";
import type { ActionFunctionArgs } from "@remix-run/node";
import {
  Form,
  Link,
  useActionData,
  useParams,
  useSubmit,
} from "@remix-run/react";
import { useEffect, useMemo, useRef, useState } from "react";
import ConfettiExplosion from "react-confetti-explosion";
import {
  LuChevronLeft,
  LuCircleCheck,
  LuFlag,
  LuRefreshCcw,
  LuTriangleAlert,
} from "react-icons/lu";
import { useOptionalUser } from "~/hooks/useUser";
import { path } from "~/utils/path";
import { findTopicContext } from "~/utils/video";

interface ActionData {
  passed: boolean;
  score: number;
  totalQuestions: number;
  userAnswers: number[];
  incorrectQuestions: number[];
  shuffledIndices: number[];
}

export async function action({ request }: ActionFunctionArgs) {
  const { client, userId } = await requirePermissions(request, {});
  const formData = await request.formData();
  const reset = formData.get("reset");

  // Handle reset case
  if (reset === "true") {
    return null;
  }

  const topicId = formData.get("topicId") as string;
  const answers = JSON.parse(formData.get("answers") as string);
  const shuffledIndices = JSON.parse(formData.get("shuffledIndices") as string);

  const context = findTopicContext(topicId);
  if (!context) {
    throw new Error("Topic not found");
  }

  const { topic, course } = context;
  let correctAnswers = 0;
  const totalQuestions = topic.challenge.length;
  const incorrectQuestions: number[] = [];

  // Map answers back to original question order using shuffled indices
  shuffledIndices.forEach((originalIndex: number, shuffledIndex: number) => {
    if (
      answers[shuffledIndex] === topic.challenge[originalIndex].correctAnswer
    ) {
      correctAnswers++;
    } else {
      incorrectQuestions.push(originalIndex);
    }
  });

  const passed = correctAnswers === totalQuestions; // 100% to pass

  const { error } = await client.from("challengeAttempt").insert({
    userId,
    courseId: course.id,
    topicId,
    passed,
  });

  if (error) {
    console.error(error);
  }

  return {
    passed,
    score: correctAnswers,
    totalQuestions,
    userAnswers: answers,
    incorrectQuestions,
    shuffledIndices,
  };
}

export default function ChallengeRoute() {
  const { id } = useParams();
  const user = useOptionalUser();
  const actionData = useActionData<ActionData>();
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const submit = useSubmit();

  if (!id) {
    throw new Error("Topic ID is required");
  }

  const context = findTopicContext(id);

  if (!context) {
    throw new Error("Topic not found");
  }

  const { module, course, topic } = context;

  // Shuffle the questions
  const shuffledQuestions = useMemo(
    () => [...topic.challenge].sort(() => Math.random() - 0.5),
    [topic.challenge]
  );

  const [answers, setAnswers] = useState<number[]>([]);
  const [isSubmitted, setIsSubmitted] = useState(false);

  useEffect(() => {
    if (actionData) {
      setIsSubmitted(true);
      if (actionData.passed && audioRef.current) {
        audioRef.current.play();
      }
    }
  }, [actionData]);

  const onAnswerChange = (questionIndex: number, answerIndex: number) => {
    const newAnswers = [...answers];
    newAnswers[questionIndex] = answerIndex;
    setAnswers(newAnswers);
  };

  const onTryAgain = () => {
    setIsSubmitted(false);
    setAnswers([]);

    // Clear the action data by submitting a reset form
    const formData = new FormData();
    formData.append("reset", "true");
    submit(formData, { method: "post", replace: true });
  };

  const onSubmit = () => {
    if (answers.length !== shuffledQuestions.length) {
      alert("Please answer all questions before submitting.");
      return;
    }

    // Smooth scroll to top when submitting
    window.scrollTo({ top: 0, behavior: "smooth" });

    const formData = new FormData();
    formData.append("topicId", id);
    formData.append("answers", JSON.stringify(answers));
    formData.append(
      "shuffledIndices",
      JSON.stringify(shuffledQuestions.map((q) => topic.challenge.indexOf(q)))
    );
    submit(formData, { method: "post" });
  };

  const getAnswerStatus = (questionIndex: number, optionIndex: number) => {
    if (!actionData || isSubmitted === false) return null;

    const originalQuestionIndex = actionData.shuffledIndices[questionIndex];
    const question = topic.challenge[originalQuestionIndex];
    const userAnswer = actionData.userAnswers[questionIndex];
    const isCorrect = optionIndex === question.correctAnswer;
    const isSelected = optionIndex === userAnswer;

    if (isCorrect && isSelected) return "correct";
    if (!isCorrect && isSelected) return "incorrect";
    return null;
  };

  const getAnswerStyles = (status: string | null) => {
    switch (status) {
      case "correct":
        return "bg-emerald-100 border-emerald-500 text-emerald-800 dark:bg-emerald-900 dark:border-emerald-500 dark:text-emerald-500";
      case "incorrect":
        return "bg-red-100 border-red-500 text-red-800 dark:bg-red-900 dark:border-red-500 dark:text-red-500";
      default:
        return "hover:bg-accent";
    }
  };

  return (
    <div className="w-full px-4 max-w-5xl mx-auto mt-8 pb-24 flex flex-col gap-8">
      <div className="flex items-center gap-2">
        <Button
          variant="primary"
          leftIcon={<LuChevronLeft />}
          className="mr-2"
          asChild
        >
          <Link to={path.to.course(module.id, course.id)}>Back to course</Link>
        </Button>

        <Button
          variant="link"
          className="text-sm text-muted-foreground"
          asChild
        >
          <Link to={path.to.course(module.id, course.id)}>{course.name}</Link>
        </Button>

        <span className="text-muted-foreground text-sm">/</span>

        <span className="text-muted-foreground text-sm font-bold">
          {topic.name}
        </span>
      </div>

      <div className="flex flex-col w-full">
        <div
          className="border rounded-lg rounded-b-none p-4"
          style={{
            backgroundColor: module?.background,
            color: module?.foreground,
          }}
        >
          <div className="flex flex-col gap-4">
            <div className="flex items-start gap-4">
              <div
                className="flex-shrink-0 size-12 text-2xl p-3 rounded-full border"
                style={{
                  backgroundColor: module?.background,
                  borderColor: module?.foreground,
                  color: module?.foreground,
                }}
              >
                <LuFlag />
              </div>
              <div className="flex flex-col">
                <h1 className="uppercase text-[10px] font-display font-bold">
                  Challenge
                </h1>
                <h2 className="text-2xl font-display tracking-tight">
                  {topic.name}
                </h2>
              </div>
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-4 border rounded-b-lg border-t-0 px-6 py-4">
          <p className="text-base text-muted-foreground">
            Test your knowledge with these multiple choice questions. You need
            to get at least 100% correct to pass.
          </p>
        </div>
      </div>

      {isSubmitted && actionData && (
        <div className="border rounded-lg px-6 py-10">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex flex-col items-center justify-center gap-2">
              <span className="text-sm font-display uppercase">Scoreboard</span>
              <span
                className={cn(
                  "text-xl font-display uppercase font-bold tracking-tight",
                  actionData.passed ? "text-emerald-500" : "text-red-500"
                )}
              >
                You Scored
              </span>
              <div
                className={cn(
                  "text-6xl font-display font-bold",
                  actionData.passed ? "text-emerald-500" : "text-red-500"
                )}
              >
                {Math.round(
                  (actionData.score / actionData.totalQuestions) * 100
                )}
                %
              </div>
            </div>
            <div className="flex flex-col gap-4">
              <p className="text-base text-muted-foreground">
                You can continue by returning to the course listing or you can
                retry this challenge and try for 100%.
              </p>
              <div className="flex items-center gap-4 w-full justify-between">
                <Button
                  size="lg"
                  variant="secondary"
                  leftIcon={<LuChevronLeft />}
                  asChild
                >
                  <Link to={path.to.course(module.id, course.id)}>
                    Return to Course Page
                  </Link>
                </Button>
                {!actionData?.passed && (
                  <Button
                    size="lg"
                    variant="primary"
                    onClick={onTryAgain}
                    rightIcon={<LuRefreshCcw />}
                  >
                    Retry Challenge
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {user ? (
        <Form method="post" className="flex flex-col gap-6">
          <input type="hidden" name="topicId" value={id} />
          <input type="hidden" name="answers" value={JSON.stringify(answers)} />

          {shuffledQuestions.map((question, questionIndex) => (
            <div key={question.id} className="border rounded-lg p-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="flex flex-col gap-2">
                  <h3 className="text-lg font-display font-bold">
                    Question {questionIndex + 1}:
                  </h3>
                  <p className="text-base text-muted-foreground">
                    {question.question}
                  </p>
                </div>
                <div className="flex flex-col gap-3">
                  {question.options.map((option, optionIndex) => {
                    const answerStatus = getAnswerStatus(
                      questionIndex,
                      optionIndex
                    );
                    const isDisabled = isSubmitted && !!actionData;

                    return (
                      <label
                        key={optionIndex}
                        className={`flex items-center gap-3 p-3 border rounded-md cursor-pointer transition-colors ${
                          isDisabled ? "cursor-default" : "hover:bg-accent"
                        } ${getAnswerStyles(answerStatus)}`}
                      >
                        <input
                          type="radio"
                          name={`question-${questionIndex}`}
                          value={optionIndex}
                          checked={answers[questionIndex] === optionIndex}
                          onChange={() =>
                            onAnswerChange(questionIndex, optionIndex)
                          }
                          disabled={isDisabled}
                          className="size-4"
                        />
                        <span className="text-sm">{option}</span>
                        {answerStatus && (
                          <span className="ml-auto text-xs font-medium">
                            {answerStatus === "correct" && "✓ Correct"}
                            {answerStatus === "incorrect" && "✗ Incorrect"}
                          </span>
                        )}
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>
          ))}

          {!isSubmitted && (
            <div className="rounded-lg border flex flex-row-reverse justify-between p-6 gap-12 items-center">
              <Button
                type="button"
                size="lg"
                variant="primary"
                leftIcon={<LuCircleCheck />}
                onClick={onSubmit}
                disabled={answers.length !== topic.challenge.length}
                className={
                  answers.length !== topic.challenge.length
                    ? "opacity-50 cursor-not-allowed"
                    : ""
                }
              >
                Submit Answers
              </Button>
              <Alert variant="warning" className="border-none">
                <LuTriangleAlert className="h-4 w-4" />
                <AlertTitle>
                  Please ensure that all questions are answered correctly
                </AlertTitle>
                <AlertDescription>
                  You can retake challenges, but they will be completely
                  randomized when a new one is started.
                </AlertDescription>
              </Alert>
            </div>
          )}
        </Form>
      ) : (
        <div className="flex justify-between items-center gap-4 border rounded-lg py-6 px-8">
          <div className="flex flex-col gap-1">
            <h3 className="text-lg font-display font-bold">Challenge Rules</h3>
            <p className="text-base text-muted-foreground">
              There is no limit on attempts, but retries will be randomized.
            </p>
          </div>
          <Button size="lg" variant="primary" asChild>
            <Link to={`${path.to.login}?redirectTo=${path.to.challenge(id)}`}>
              Login to Take Challenge
            </Link>
          </Button>
        </div>
      )}

      {actionData?.passed && (
        <>
          <audio ref={audioRef} preload="auto">
            <source src="/victory.mp3" type="audio/mpeg" />
          </audio>
          <div className="fixed inset-0 flex items-center justify-center pointer-events-none">
            <ConfettiExplosion
              particleCount={200}
              force={1}
              duration={3000}
              width={1600}
            />
          </div>
        </>
      )}
    </div>
  );
}
