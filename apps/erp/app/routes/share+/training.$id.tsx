import { requirePermissions } from "@carbon/auth/auth.server";
import type { JSONContent } from "@carbon/react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  BarProgress,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  cn,
  generateHTML,
  HStack,
  NumberField,
  NumberInput,
  RadioGroup,
  RadioGroupItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  VStack
} from "@carbon/react";
import { useEffect, useMemo, useRef, useState } from "react";
import ConfettiExplosion from "react-confetti-explosion";
import {
  LuArrowRight,
  LuChevronLeft,
  LuChevronRight,
  LuCircleCheck,
  LuCircleX,
  LuClock,
  LuFlag,
  LuHouse,
  LuRefreshCcw
} from "react-icons/lu";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  data,
  Link,
  useActionData,
  useLoaderData,
  useSubmit
} from "react-router";
import {
  getTrainingAssignmentForCompletion,
  insertTrainingCompletion
} from "~/modules/resources";
import type { TrainingQuestion } from "~/modules/resources/types";

const PASSING_THRESHOLD = 0.8;

interface ActionData {
  passed: boolean;
  score: number;
  totalQuestions: number;
  userAnswers: Record<string, UserAnswer>;
  correctAnswers: number;
}

type UserAnswer = {
  type: string;
  value: string | string[] | number | boolean | Record<string, string>;
  correct: boolean;
};

export async function loader({ params, request }: LoaderFunctionArgs) {
  const { client, userId, companyId } = await requirePermissions(request, {
    role: "employee"
  });

  const { id } = params;
  if (!id) {
    throw new Response("Assignment ID is required", { status: 400 });
  }

  const assignment = await getTrainingAssignmentForCompletion(client, id);

  if (assignment.error || !assignment.data) {
    throw new Response("Training assignment not found", { status: 404 });
  }

  const training = assignment.data.training;
  if (!training || Array.isArray(training)) {
    throw new Response("Training not found", { status: 404 });
  }

  if (training.status !== "Active") {
    throw new Response("This training is not currently active", {
      status: 400
    });
  }

  const questions = (training.trainingQuestion ?? []) as TrainingQuestion[];
  const sortedQuestions = questions.sort((a, b) => a.sortOrder - b.sortOrder);

  return {
    assignment: assignment.data,
    training: {
      id: training.id,
      name: training.name,
      description: training.description,
      content: training.content,
      frequency: training.frequency,
      type: training.type,
      estimatedDuration: training.estimatedDuration
    },
    questions: sortedQuestions,
    userId,
    companyId
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { client, userId, companyId } = await requirePermissions(request, {
    role: "employee"
  });

  const { id } = params;
  if (!id) {
    throw new Response("Assignment ID is required", { status: 400 });
  }

  const formData = await request.formData();
  const reset = formData.get("reset");

  if (reset === "true") {
    return null;
  }

  const answersJson = formData.get("answers") as string;
  const questionsJson = formData.get("questions") as string;

  if (!answersJson || !questionsJson) {
    return data({ error: "Missing answers or questions" }, { status: 400 });
  }

  const userAnswers = JSON.parse(answersJson) as Record<string, UserAnswer>;
  const questions = JSON.parse(questionsJson) as TrainingQuestion[];

  let correctAnswers = 0;
  const totalQuestions = questions.length;

  const gradedAnswers: Record<string, UserAnswer> = {};

  for (const question of questions) {
    const userAnswer = userAnswers[question.id];
    if (!userAnswer) {
      gradedAnswers[question.id] = {
        type: question.type,
        value: "",
        correct: false
      };
      continue;
    }

    let isCorrect = false;

    switch (question.type) {
      case "MultipleChoice":
        isCorrect =
          question.correctAnswers?.includes(userAnswer.value as string) ??
          false;
        break;

      case "TrueFalse":
        isCorrect = question.correctBoolean === (userAnswer.value === "true");
        break;

      case "MultipleAnswers":
        const userSelectedAnswers = userAnswer.value as string[];
        const correctAnswerSet = new Set(question.correctAnswers ?? []);
        const userAnswerSet = new Set(userSelectedAnswers);
        isCorrect =
          correctAnswerSet.size === userAnswerSet.size &&
          [...correctAnswerSet].every((answer) => userAnswerSet.has(answer));
        break;

      case "MatchingPairs":
        const userPairs = userAnswer.value as Record<string, string>;
        const correctPairs = (
          typeof question.matchingPairs === "string"
            ? JSON.parse(question.matchingPairs)
            : (question.matchingPairs ?? [])
        ) as { left: string; right: string }[];
        isCorrect = correctPairs.every(
          (pair) => userPairs[pair.left] === pair.right
        );
        break;

      case "Numerical":
        const userNumber = parseFloat(userAnswer.value as string);
        const correctNumber = question.correctNumber ?? 0;
        const tolerance = question.tolerance ?? 0;
        isCorrect =
          Math.abs(userNumber - correctNumber) <= tolerance ||
          userNumber === correctNumber;
        break;
    }

    if (isCorrect) {
      correctAnswers++;
    }

    gradedAnswers[question.id] = {
      ...userAnswer,
      correct: isCorrect
    };
  }

  const score = totalQuestions > 0 ? correctAnswers / totalQuestions : 1;
  const passed = score >= PASSING_THRESHOLD;

  if (passed) {
    await insertTrainingCompletion(client, {
      trainingAssignmentId: id,
      employeeId: userId,
      period: null,
      companyId,
      completedBy: userId,
      createdBy: userId
    });
  }

  return {
    passed,
    score,
    totalQuestions,
    userAnswers: gradedAnswers,
    correctAnswers
  };
}

export default function TrainingWizard() {
  const { training, questions } = useLoaderData<typeof loader>();
  const actionData = useActionData<ActionData>();
  const submit = useSubmit();
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const [currentStep, setCurrentStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, UserAnswer>>({});
  const [isSubmitted, setIsSubmitted] = useState(false);

  const totalSteps = questions.length + 1;
  const isContentStep = currentStep === 0;
  const currentQuestionIndex = currentStep - 1;
  const currentQuestion = questions[currentQuestionIndex];
  const isLastStep = currentStep === totalSteps - 1;

  useEffect(() => {
    if (actionData) {
      setIsSubmitted(true);
      if (actionData.passed && audioRef.current) {
        // biome-ignore lint/suspicious/noEmptyBlockStatements: suppressed due to migration
        audioRef.current.play().catch(() => {});
      }
    }
  }, [actionData]);

  const progress = useMemo(() => {
    return ((currentStep + 1) / totalSteps) * 100;
  }, [currentStep, totalSteps]);

  const handleNext = () => {
    if (currentStep < totalSteps - 1) {
      setCurrentStep(currentStep + 1);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  const handlePrevious = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  const handleSubmit = () => {
    window.scrollTo({ top: 0, behavior: "smooth" });

    const formData = new FormData();
    formData.append("answers", JSON.stringify(answers));
    formData.append("questions", JSON.stringify(questions));
    submit(formData, { method: "post" });
  };

  const handleRetry = () => {
    setIsSubmitted(false);
    setAnswers({});
    setCurrentStep(0);

    const formData = new FormData();
    formData.append("reset", "true");
    submit(formData, { method: "post", replace: true });
  };

  const handleAnswerChange = (
    questionId: string,
    type: string,
    value: string | string[] | number | boolean | Record<string, string>
  ) => {
    setAnswers((prev) => ({
      ...prev,
      [questionId]: { type, value, correct: false }
    }));
  };

  const isCurrentQuestionAnswered = () => {
    if (isContentStep) return true;
    const answer = answers[currentQuestion?.id];
    if (!answer) return false;

    switch (currentQuestion?.type) {
      case "MultipleChoice":
      case "TrueFalse":
        return answer.value !== "" && answer.value !== undefined;
      case "MultipleAnswers":
        return Array.isArray(answer.value) && answer.value.length > 0;
      case "MatchingPairs":
        const matchPairs =
          typeof currentQuestion.matchingPairs === "string"
            ? JSON.parse(currentQuestion.matchingPairs)
            : (currentQuestion.matchingPairs ?? []);
        const matchUserPairs = answer.value as Record<string, string>;
        return matchPairs.every(
          (pair: { left: string }) =>
            matchUserPairs[pair.left] && matchUserPairs[pair.left] !== ""
        );
      case "Numerical":
        return (
          answer.value !== "" && !isNaN(parseFloat(answer.value as string))
        );
      default:
        return false;
    }
  };

  const canProceed = isContentStep || isCurrentQuestionAnswered();

  if (isSubmitted && actionData) {
    return (
      <ResultsView
        actionData={actionData}
        training={training}
        questions={questions}
        onRetry={handleRetry}
        audioRef={audioRef}
      />
    );
  }

  return (
    <VStack
      spacing={8}
      className="w-full min-h-screen max-w-4xl mx-auto p-4 md:p-8 pb-24"
    >
      <BarProgress progress={progress} gradient />

      <Card className="w-full">
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="flex-shrink-0 size-12 text-2xl p-3 rounded-full border bg-primary/10 text-primary">
                <LuFlag />
              </div>
              <div className="flex flex-col">
                <span className="uppercase text-[10px] font-display font-bold text-muted-foreground">
                  Training
                </span>
                <CardTitle className="text-2xl">{training.name}</CardTitle>
              </div>
            </div>
            {training.estimatedDuration && (
              <span className="flex items-center gap-1 text-sm text-muted-foreground mt-1">
                <LuClock className="size-4" />
                {training.estimatedDuration}
              </span>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {isContentStep ? (
            <ContentStep training={training} />
          ) : (
            <QuestionStep
              question={currentQuestion}
              questionIndex={currentQuestionIndex}
              totalQuestions={questions.length}
              answer={answers[currentQuestion.id]}
              onAnswerChange={handleAnswerChange}
            />
          )}
        </CardContent>
      </Card>

      <div className="flex justify-between w-full gap-4">
        <Button
          isRound
          variant="secondary"
          size="lg"
          leftIcon={<LuChevronLeft />}
          onClick={handlePrevious}
          isDisabled={currentStep === 0}
        >
          Previous
        </Button>

        {isLastStep && questions.length > 0 ? (
          <Button
            isRound
            variant="primary"
            size="lg"
            rightIcon={<LuCircleCheck />}
            onClick={handleSubmit}
            isDisabled={!canProceed}
          >
            Submit Training
          </Button>
        ) : questions.length === 0 ? (
          <Button
            isRound
            variant="primary"
            size="lg"
            rightIcon={<LuCircleCheck />}
            onClick={handleSubmit}
          >
            Complete Training
          </Button>
        ) : (
          <Button
            isRound
            variant="primary"
            size="lg"
            rightIcon={<LuChevronRight />}
            onClick={handleNext}
            isDisabled={!canProceed}
          >
            {isContentStep ? "Start Questions" : "Next Question"}
          </Button>
        )}
      </div>

      {!isContentStep && questions.length > 0 && (
        <div className="text-sm text-muted-foreground">
          Question {currentQuestionIndex + 1} of {questions.length}
        </div>
      )}
    </VStack>
  );
}

function ContentStep({
  training
}: {
  training: {
    name: string;
    description: string | null;
    content: unknown;
    estimatedDuration: string | null;
  };
}) {
  const hasContent =
    training.content &&
    typeof training.content === "object" &&
    "type" in (training.content as object);

  const htmlContent = useMemo(() => {
    if (!hasContent) return "";
    try {
      return generateHTML(training.content as JSONContent);
    } catch {
      return "";
    }
  }, [training.content, hasContent]);

  return (
    <VStack spacing={4} className="w-full">
      {training.description && (
        <p className="text-muted-foreground">{training.description}</p>
      )}

      {training.estimatedDuration && (
        <div className="text-sm text-muted-foreground">
          Estimated duration: {training.estimatedDuration}
        </div>
      )}

      {htmlContent ? (
        <div
          className="prose dark:prose-invert max-w-none w-full"
          dangerouslySetInnerHTML={{
            __html: htmlContent
          }}
        />
      ) : (
        <p className="text-muted-foreground italic">
          No training content available. Please proceed to the questions.
        </p>
      )}
    </VStack>
  );
}

function QuestionStep({
  question,
  questionIndex,
  totalQuestions,
  answer,
  onAnswerChange
}: {
  question: TrainingQuestion;
  questionIndex: number;
  totalQuestions: number;
  answer?: UserAnswer;
  onAnswerChange: (
    questionId: string,
    type: string,
    value: string | string[] | number | boolean | Record<string, string>
  ) => void;
}) {
  const renderQuestionInput = () => {
    switch (question.type) {
      case "MultipleChoice":
        return (
          <RadioGroup
            value={(answer?.value as string) ?? ""}
            onValueChange={(value) =>
              onAnswerChange(question.id, question.type, value)
            }
            className="flex flex-col gap-2 w-full"
          >
            {question.options?.map((option, index) => (
              <label
                key={index}
                className="flex items-center gap-3 p-3 border rounded-md cursor-pointer hover:bg-accent"
              >
                <RadioGroupItem value={option} id={`option-${index}`} />
                <span>{option}</span>
              </label>
            ))}
          </RadioGroup>
        );

      case "TrueFalse":
        return (
          <RadioGroup
            value={(answer?.value as string) ?? ""}
            onValueChange={(value) =>
              onAnswerChange(question.id, question.type, value)
            }
            className="flex flex-col gap-2 w-full"
          >
            <label className="flex items-center gap-3 p-3 border rounded-md cursor-pointer hover:bg-accent">
              <RadioGroupItem value="true" id="true" />
              <span>True</span>
            </label>
            <label className="flex items-center gap-3 p-3 border rounded-md cursor-pointer hover:bg-accent">
              <RadioGroupItem value="false" id="false" />
              <span>False</span>
            </label>
          </RadioGroup>
        );

      case "MultipleAnswers":
        const selectedAnswers = (answer?.value as string[]) ?? [];
        return (
          <div className="flex flex-col gap-2 w-full">
            {question.options?.map((option, index) => (
              <label
                key={index}
                className="flex items-center gap-3 p-3 border rounded-md cursor-pointer hover:bg-accent"
              >
                <Checkbox
                  checked={selectedAnswers.includes(option)}
                  onCheckedChange={(checked) => {
                    const newAnswers = checked
                      ? [...selectedAnswers, option]
                      : selectedAnswers.filter((a) => a !== option);
                    onAnswerChange(question.id, question.type, newAnswers);
                  }}
                />
                <span>{option}</span>
              </label>
            ))}
          </div>
        );

      case "MatchingPairs":
        const pairs =
          typeof question.matchingPairs === "string"
            ? JSON.parse(question.matchingPairs)
            : (question.matchingPairs ?? []);
        const userPairs = (answer?.value as Record<string, string>) ?? {};
        const rightOptions = pairs.map((pair: { right: string }) => pair.right);

        return (
          <div className="flex flex-col gap-2 w-full">
            {pairs.map(
              (pair: { left: string; right: string }, index: number) => (
                <div
                  key={index}
                  className="flex items-center gap-4 p-3 border rounded-md"
                >
                  <span className="font-medium min-w-[120px]">{pair.left}</span>
                  <span className="text-muted-foreground">
                    <LuArrowRight className="text-muted-foreground" />
                  </span>
                  <Select
                    value={userPairs[pair.left] ?? ""}
                    onValueChange={(value) => {
                      const newPairs = {
                        ...userPairs,
                        [pair.left]: value
                      };
                      onAnswerChange(question.id, question.type, newPairs);
                    }}
                  >
                    <SelectTrigger className="flex-1">
                      <SelectValue placeholder="Select a match..." />
                    </SelectTrigger>
                    <SelectContent>
                      {rightOptions.map((option: string, optIndex: number) => (
                        <SelectItem key={optIndex} value={option}>
                          {option}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )
            )}
          </div>
        );

      case "Numerical":
        return (
          <div className="space-y-2">
            <NumberField
              value={parseFloat((answer?.value as string) ?? "") || undefined}
              onChange={(value) =>
                onAnswerChange(
                  question.id,
                  question.type,
                  value?.toString() ?? ""
                )
              }
              className="max-w-xs"
            >
              <NumberInput placeholder="Enter your answer..." />
            </NumberField>
            {(question.tolerance ?? 0) > 0 && (
              <p className="text-sm text-muted-foreground">
                Tolerance: +/- {question.tolerance}
              </p>
            )}
          </div>
        );

      default:
        return <p>Unknown question type</p>;
    }
  };

  return (
    <VStack spacing={4} className="w-full">
      <div className="flex flex-col gap-2">
        <h3 className="text-lg font-display font-bold">
          Question {questionIndex + 1} of {totalQuestions}
        </h3>
        <p className="text-base">{question.question}</p>
      </div>

      {renderQuestionInput()}
    </VStack>
  );
}

function ResultsView({
  actionData,
  training,
  questions,
  onRetry,
  audioRef
}: {
  actionData: ActionData;
  training: { name: string };
  questions: TrainingQuestion[];
  onRetry: () => void;
  audioRef: React.RefObject<HTMLAudioElement>;
}) {
  const scorePercent = Math.round(actionData.score * 100);

  return (
    <VStack
      spacing={8}
      className="w-full min-h-screen max-w-4xl mx-auto p-4 md:p-8 pb-24"
    >
      <Card className="w-full">
        <CardHeader>
          <div className="flex items-center gap-4">
            <div
              className={cn(
                "flex-shrink-0 size-12 text-3xl p-2 rounded-full border",
                actionData.passed
                  ? "bg-emerald-100 text-emerald-500 border-emerald-500 dark:bg-emerald-900"
                  : "bg-red-100 text-red-500 border-red-500 dark:bg-red-900"
              )}
            >
              {actionData.passed ? <LuCircleCheck /> : <LuCircleX />}
            </div>
            <div className="flex flex-col">
              <span className="uppercase text-[10px] font-display font-bold text-muted-foreground">
                Training Complete
              </span>
              <CardTitle className="text-2xl">{training.name}</CardTitle>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="flex flex-col items-center justify-center gap-2">
              <span
                className={cn(
                  "text-xl uppercase font-mono font-bold tracking-tight",
                  actionData.passed ? "text-emerald-500" : "text-red-500"
                )}
              >
                {actionData.passed ? "Passed" : "Failed"}
              </span>
              <div
                className={cn(
                  "text-6xl font-mono font-bold",
                  actionData.passed ? "text-emerald-500" : "text-red-500"
                )}
              >
                {scorePercent}%
              </div>
              <p className="text-sm text-muted-foreground">
                {actionData.correctAnswers} of {actionData.totalQuestions}{" "}
                correct
              </p>
              <p className="text-sm text-muted-foreground">
                (Passing score: {Math.round(PASSING_THRESHOLD * 100)}%)
              </p>
            </div>

            <div className="flex flex-col gap-4">
              {actionData.passed ? (
                <>
                  <p className="text-base text-muted-foreground">
                    Congratulations! You have successfully completed this
                    training. Your completion has been recorded.
                  </p>
                  <Alert variant="success">
                    <LuCircleCheck className="h-4 w-4" />
                    <AlertTitle>Training Complete</AlertTitle>
                    <AlertDescription>
                      This training has been marked as completed for your
                      records.
                    </AlertDescription>
                  </Alert>
                </>
              ) : (
                <p className="text-base text-muted-foreground">
                  Unfortunately, you did not pass this training. You need at
                  least {Math.round(PASSING_THRESHOLD * 100)}% to pass. Please
                  review the material and try again.
                </p>
              )}

              <HStack className="w-full justify-between">
                {!actionData.passed && (
                  <Button
                    size="lg"
                    isRound
                    variant="primary"
                    onClick={onRetry}
                    rightIcon={<LuRefreshCcw />}
                    className="flex-1"
                  >
                    Retry Training
                  </Button>
                )}
                <Button
                  size="lg"
                  isRound
                  variant={actionData.passed ? "primary" : "secondary"}
                  asChild
                  leftIcon={<LuHouse />}
                  className="flex-1"
                >
                  <Link to="/">Return Home</Link>
                </Button>
              </HStack>
            </div>
          </div>
        </CardContent>
      </Card>

      {questions.length > 0 && (
        <Card className="w-full">
          <CardHeader>
            <CardTitle>Question Review</CardTitle>
          </CardHeader>
          <CardContent>
            <VStack spacing={4}>
              {questions.map((question, index) => {
                const userAnswer = actionData.userAnswers[question.id];
                const isCorrect = userAnswer?.correct ?? false;

                return (
                  <div
                    key={question.id}
                    className={cn(
                      "w-full p-4 border rounded-lg",
                      isCorrect
                        ? "bg-emerald-50 border-emerald-200 dark:bg-emerald-950 dark:border-emerald-800"
                        : "bg-red-50 border-red-200 dark:bg-red-950 dark:border-red-800"
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className={cn(
                          "flex-shrink-0 mt-1",
                          isCorrect ? "text-emerald-500" : "text-red-500"
                        )}
                      >
                        {isCorrect ? <LuCircleCheck /> : <LuCircleX />}
                      </div>
                      <div className="flex-1">
                        <p className="font-medium">
                          {index + 1}. {question.question}
                        </p>
                        <p className="text-sm mt-2">
                          <span className="text-muted-foreground">
                            Your answer:{" "}
                          </span>
                          <span
                            className={
                              isCorrect ? "text-emerald-600" : "text-red-600"
                            }
                          >
                            {formatAnswer(userAnswer?.value, question)}
                          </span>
                        </p>
                        {!isCorrect && (
                          <p className="text-sm mt-1">
                            <span className="text-muted-foreground">
                              Correct answer:{" "}
                            </span>
                            <span className="text-emerald-600">
                              {formatCorrectAnswer(question)}
                            </span>
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </VStack>
          </CardContent>
        </Card>
      )}

      {actionData.passed && (
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
    </VStack>
  );
}

function formatAnswer(
  value: UserAnswer["value"] | undefined,
  question: TrainingQuestion
): string {
  if (value === undefined || value === "" || value === null) {
    return "Not answered";
  }

  switch (question.type) {
    case "TrueFalse":
      return value === "true" ? "True" : "False";
    case "MultipleAnswers":
      return Array.isArray(value) ? value.join(", ") : String(value);
    case "MatchingPairs":
      if (typeof value === "object" && !Array.isArray(value)) {
        return Object.entries(value)
          .map(([left, right]) => `${left} = ${right}`)
          .join(", ");
      }
      return String(value);
    default:
      return String(value);
  }
}

function formatCorrectAnswer(question: TrainingQuestion): string {
  switch (question.type) {
    case "MultipleChoice":
      return question.correctAnswers?.[0] ?? "";
    case "TrueFalse":
      return question.correctBoolean ? "True" : "False";
    case "MultipleAnswers":
      return question.correctAnswers?.join(", ") ?? "";
    case "MatchingPairs":
      const displayPairs =
        typeof question.matchingPairs === "string"
          ? JSON.parse(question.matchingPairs)
          : (question.matchingPairs ?? []);
      return displayPairs
        .map(
          (pair: { left: string; right: string }) =>
            `${pair.left} = ${pair.right}`
        )
        .join(", ");
    case "Numerical":
      return String(question.correctNumber);
    default:
      return "";
  }
}
