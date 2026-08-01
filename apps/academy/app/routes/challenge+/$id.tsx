import { requirePermissions } from "@carbon/auth/auth.server";
import { getLogger } from "@carbon/logger";
import { cn } from "@carbon/react";
import { useEffect, useMemo, useRef, useState } from "react";
import ConfettiExplosion from "react-confetti-explosion";
import { LuFlag, LuRefreshCcw, LuTriangleAlert } from "react-icons/lu";
import type { ActionFunctionArgs } from "react-router";
import { Form, Link, useActionData, useParams, useSubmit } from "react-router";
import { Breadcrumb } from "~/components/Breadcrumb";
import { LearnShell } from "~/components/LearnShell";
import { useOptionalUser } from "~/hooks/useUser";
import { path } from "~/utils/path";
import { findTopicContext } from "~/utils/video";

const log = getLogger("academy");

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
    passed
  });

  if (error) {
    log.error("Failed to insert challenge attempt", { error });
  }

  return {
    passed,
    score: correctAnswers,
    totalQuestions,
    userAnswers: answers,
    incorrectQuestions,
    shuffledIndices
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
        return "border-ed-green-border bg-ed-green-bg text-ed-green-text";
      case "incorrect":
        return "border-ed-red-border bg-ed-red-bg text-ed-red";
      default:
        return "border-ed-hairline bg-ed-paper hover:bg-white/70";
    }
  };

  return (
    <LearnShell activeCourseId={course.id}>
      <div className="max-w-190">
        <Breadcrumb
          items={[
            { label: "Courses", href: path.to.root },
            {
              label: course.name,
              href: path.to.course(module.id, course.id)
            },
            { label: topic.name }
          ]}
        />

        <div className="mt-4 flex items-center gap-2 font-mono text-ed-11 uppercase tracking-[0.08em] text-ed-ink/50">
          <LuFlag className="size-3.5 text-ed-ink/45" />
          Challenge
        </div>
        <h1 className="reference-title mt-1.5">{topic.name}</h1>
        <p className="reference-desc mt-3">
          Test your knowledge with these multiple-choice questions. You need to
          score 100% to pass.
        </p>

        {isSubmitted && actionData && (
          <div className="callout-box mt-8 p-8">
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              <div className="flex flex-col items-center justify-center gap-1.5">
                <span className="font-mono text-ed-11 uppercase tracking-[0.08em] text-ed-ink/50">
                  Scoreboard
                </span>
                <span
                  className={cn(
                    "text-6xl font-semi",
                    actionData.passed ? "text-ed-green-strong" : "text-ed-red"
                  )}
                >
                  {Math.round(
                    (actionData.score / actionData.totalQuestions) * 100
                  )}
                  %
                </span>
                <span
                  className={cn(
                    "text-ed-13 font-book",
                    actionData.passed ? "text-ed-green-strong" : "text-ed-red"
                  )}
                >
                  {actionData.passed ? "You passed" : "Not quite"}
                </span>
              </div>
              <div className="flex flex-col justify-center gap-4">
                <p className="text-ed-15 leading-[1.6] text-ed-ink-78">
                  You can continue by returning to the course, or retry this
                  challenge and aim for 100%.
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  <Link
                    to={path.to.course(module.id, course.id)}
                    className="glass-pill inline-flex h-10 items-center justify-center rounded-lg px-4 text-ed-14 font-book text-ink-ui no-underline transition-colors hover:text-ed-ink"
                  >
                    Return to course
                  </Link>
                  {!actionData.passed && (
                    <button
                      type="button"
                      onClick={onTryAgain}
                      className="group relative inline-flex h-10 items-center justify-center gap-2 rounded-lg px-4"
                    >
                      <span
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-0 rounded-lg cta-btn-dark"
                      />
                      <span
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-0 rounded-lg btn-dark-hover opacity-0 transition-opacity duration-200 ease-out group-hover:opacity-100"
                      />
                      <span className="text-on-dark relative z-10 inline-flex items-center gap-2 text-ed-14 font-book tracking-[0.15px]">
                        <LuRefreshCcw className="size-3.5" />
                        Retry challenge
                      </span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {user ? (
          <Form method="post" className="mt-8 flex flex-col gap-5">
            <input type="hidden" name="topicId" value={id} />
            <input
              type="hidden"
              name="answers"
              value={JSON.stringify(answers)}
            />

            {shuffledQuestions.map((question, questionIndex) => (
              <div key={question.id} className="callout-box p-6">
                <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                  <div className="flex flex-col gap-2">
                    <span className="font-mono text-ed-10 font-semibold uppercase tracking-[0.08em] text-ed-ink/50">
                      Question {questionIndex + 1} of {shuffledQuestions.length}
                    </span>
                    <p className="text-ed-16 font-demi leading-[1.5] text-ed-ink">
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
                          className={`flex items-center gap-3 rounded-lg border px-4 py-3 transition-colors ${
                            isDisabled ? "cursor-default" : "cursor-pointer"
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
                            className="size-4 accent-ed-brand"
                          />
                          <span className="text-ed-14">{option}</span>
                          {answerStatus && (
                            <span className="ml-auto font-mono text-ed-11 font-medium uppercase">
                              {answerStatus === "correct" && "Correct"}
                              {answerStatus === "incorrect" && "Incorrect"}
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
              <div className="callout-box flex flex-col gap-4 p-6 sm:flex-row-reverse sm:items-center sm:justify-between">
                <button
                  type="button"
                  onClick={onSubmit}
                  disabled={answers.length !== topic.challenge.length}
                  className={`group relative inline-flex h-11 shrink-0 items-center justify-center rounded-lg px-5 ${
                    answers.length !== topic.challenge.length
                      ? "cursor-not-allowed opacity-50"
                      : ""
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 rounded-lg cta-btn-dark"
                  />
                  <span className="text-on-dark relative z-10 text-ed-15 font-book tracking-[0.15px]">
                    Submit answers
                  </span>
                </button>
                <div className="flex items-start gap-2.5 text-ed-amber-text">
                  <LuTriangleAlert className="mt-0.5 size-4 shrink-0" />
                  <div className="flex flex-col gap-0.5">
                    <p className="text-ed-14 font-demi">
                      Answer every question before submitting
                    </p>
                    <p className="text-ed-13 text-ed-ink/60">
                      You can retake challenges, but they are fully randomized
                      each time.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </Form>
        ) : (
          <div className="callout-box mt-8 flex flex-col items-start justify-between gap-4 p-6 sm:flex-row sm:items-center">
            <div className="flex flex-col gap-1">
              <h3 className="text-ed-16 font-demi text-ed-ink">
                Challenge rules
              </h3>
              <p className="text-ed-14 text-ed-ink-78">
                There is no limit on attempts, but retries are randomized.
              </p>
            </div>
            <Link
              to={`${path.to.login}?redirectTo=${path.to.challenge(id)}`}
              className="group relative inline-flex h-11 shrink-0 items-center justify-center rounded-lg px-5 no-underline"
            >
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 rounded-lg cta-btn-dark"
              />
              <span className="text-on-dark relative z-10 text-ed-15 font-book tracking-[0.15px]">
                Login to take challenge
              </span>
            </Link>
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
    </LearnShell>
  );
}
