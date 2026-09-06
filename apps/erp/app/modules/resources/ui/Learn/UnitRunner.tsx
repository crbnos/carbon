import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  HStack,
  RadioGroup,
  RadioGroupItem,
  Status,
  VStack
} from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { useState } from "react";
import {
  LuBookOpen,
  LuCircle,
  LuCircleCheck,
  LuCircleX,
  LuExternalLink,
  LuFlaskConical
} from "react-icons/lu";
import { Link, useFetcher } from "react-router";
import type {
  LearnChallengeMeta,
  LearnServedQuestion,
  LearnUnit
} from "~/modules/resources";
import { path } from "~/utils/path";
import Celebration from "./Celebration";

export type QuizFeedbackItem = {
  questionSlug: string;
  prompt: string;
  correct: boolean;
  explanation: string;
  docsUrl: string;
};

export type QuizResultData = {
  passed: boolean;
  correctCount: number;
  questionCount: number;
  xpAwarded: number;
  feedback: QuizFeedbackItem[];
};

export type ChallengeState = {
  attemptId: string | null;
  passed: boolean;
  failedRequirement: string | null;
  message: string | null;
  evidence: Record<string, unknown> | null;
  checkCount: number;
};

type UnitRunnerProps = {
  trackSlug: string;
  trackTitle: string;
  unit: LearnUnit;
  questions: LearnServedQuestion[] | null;
  quizResult: QuizResultData | null;
  challenge: LearnChallengeMeta | null;
  challengeState: ChallengeState | null;
  companyName: string;
  completed: boolean;
};

const DocsLinks = ({ unit }: { unit: LearnUnit }) => {
  const { t } = useLingui();
  if (unit.docs.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">
          <HStack spacing={2} className="items-center">
            <LuBookOpen /> {t`Read this first`}
          </HStack>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <VStack spacing={2}>
          {unit.docs.map((doc) => (
            <a
              key={doc.url}
              href={doc.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between gap-3 rounded-lg border border-border p-3 hover:border-foreground/20 transition-colors"
            >
              <span className="text-sm font-medium">{doc.title}</span>
              <LuExternalLink className="text-muted-foreground shrink-0" />
            </a>
          ))}
        </VStack>
      </CardContent>
    </Card>
  );
};

const QuizForm = ({
  trackSlug,
  unitSlug,
  questions
}: {
  trackSlug: string;
  unitSlug: string;
  questions: LearnServedQuestion[];
}) => {
  const { t } = useLingui();
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});

  const toggleMulti = (slug: string, optionId: string) => {
    setAnswers((prev) => {
      const current = Array.isArray(prev[slug]) ? (prev[slug] as string[]) : [];
      return {
        ...prev,
        [slug]: current.includes(optionId)
          ? current.filter((id) => id !== optionId)
          : [...current, optionId]
      };
    });
  };

  const responses = questions.map((q) => ({
    questionSlug: q.slug,
    selected: answers[q.slug] ?? (q.kind === "multi" ? [] : "")
  }));

  const answeredAll = questions.every((q) => {
    const a = answers[q.slug];
    return Array.isArray(a) ? a.length > 0 : Boolean(a);
  });

  return (
    <form method="post" action={path.to.learnUnit(trackSlug, unitSlug)}>
      <input type="hidden" name="intent" value="submit-quiz" />
      <input type="hidden" name="responses" value={JSON.stringify(responses)} />
      <VStack spacing={4}>
        {questions.map((question, index) => (
          <Card key={question.slug}>
            <CardHeader>
              <span className="text-xs text-muted-foreground tabular-nums">
                {t`Question ${index + 1} of ${questions.length}`}
              </span>
              <CardTitle className="text-base font-medium text-pretty">
                {question.prompt}
              </CardTitle>
              {question.kind === "multi" && (
                <span className="text-xs text-muted-foreground">
                  {t`Choose all that apply`}
                </span>
              )}
            </CardHeader>
            <CardContent>
              {question.kind === "multi" ? (
                <VStack spacing={2}>
                  {question.options.map((option) => (
                    <label
                      key={option.id}
                      className="flex items-start gap-3 rounded-lg border border-border p-3 cursor-pointer hover:border-foreground/20"
                    >
                      <Checkbox
                        checked={(
                          (answers[question.slug] as string[]) ?? []
                        ).includes(option.id)}
                        onCheckedChange={() =>
                          toggleMulti(question.slug, option.id)
                        }
                      />
                      <span className="text-sm">{option.text}</span>
                    </label>
                  ))}
                </VStack>
              ) : (
                <RadioGroup
                  value={(answers[question.slug] as string) ?? ""}
                  onValueChange={(value) =>
                    setAnswers((prev) => ({ ...prev, [question.slug]: value }))
                  }
                >
                  <VStack spacing={2}>
                    {question.options.map((option) => (
                      <label
                        key={option.id}
                        className="flex items-start gap-3 rounded-lg border border-border p-3 cursor-pointer hover:border-foreground/20"
                      >
                        <RadioGroupItem value={option.id} />
                        <span className="text-sm">{option.text}</span>
                      </label>
                    ))}
                  </VStack>
                </RadioGroup>
              )}
            </CardContent>
          </Card>
        ))}
        <Button type="submit" size="lg" isDisabled={!answeredAll}>
          {t`Check my answers`}
        </Button>
      </VStack>
    </form>
  );
};

const QuizResult = ({
  result,
  trackSlug,
  unitSlug
}: {
  result: QuizResultData;
  trackSlug: string;
  unitSlug: string;
}) => {
  const { t } = useLingui();
  return (
    <VStack spacing={4}>
      {result.passed && <Celebration />}
      <Card>
        <CardContent className="p-6">
          <VStack spacing={3} className="items-center text-center">
            <span
              className={`text-5xl font-mono font-bold tabular-nums ${
                result.passed ? "text-emerald-500" : "text-destructive"
              }`}
            >
              {result.correctCount}/{result.questionCount}
            </span>
            {result.passed ? (
              <>
                <Status color="green">{t`Unit complete`}</Status>
                {result.xpAwarded > 0 && (
                  <span className="text-sm text-muted-foreground tabular-nums">
                    {t`+${result.xpAwarded} XP`}
                  </span>
                )}
              </>
            ) : (
              <>
                <Status color="orange">{t`Not yet`}</Status>
                <span className="text-sm text-muted-foreground max-w-md">
                  {t`Every question has to be right to pass this unit. Read the explanations below, then try again — the XP is lower on a retry, but understanding it is the point.`}
                </span>
              </>
            )}
          </VStack>
        </CardContent>
      </Card>

      <VStack spacing={3}>
        {result.feedback.map((item) => (
          <Card key={item.questionSlug}>
            <CardContent className="p-4">
              <HStack spacing={3} className="items-start">
                <span
                  className={`mt-0.5 shrink-0 ${
                    item.correct ? "text-emerald-500" : "text-destructive"
                  }`}
                >
                  {item.correct ? <LuCircleCheck /> : <LuCircleX />}
                </span>
                <VStack spacing={2}>
                  <span className="text-sm font-medium text-pretty">
                    {item.prompt}
                  </span>
                  <span className="text-sm text-muted-foreground text-pretty">
                    {item.explanation}
                  </span>
                  <a
                    href={item.docsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-primary hover:underline inline-flex items-center gap-1"
                  >
                    {t`Read why`} <LuExternalLink />
                  </a>
                </VStack>
              </HStack>
            </CardContent>
          </Card>
        ))}
      </VStack>

      <HStack spacing={2}>
        {!result.passed && (
          <form method="post" action={path.to.learnUnit(trackSlug, unitSlug)}>
            <input type="hidden" name="intent" value="start-quiz" />
            <Button type="submit">{t`Try again`}</Button>
          </form>
        )}
        <Button variant="secondary" asChild>
          <Link to={path.to.learnTrack(trackSlug)}>{t`Back to the track`}</Link>
        </Button>
      </HStack>
    </VStack>
  );
};

const ChallengePanel = ({
  trackSlug,
  unitSlug,
  challenge,
  state,
  companyName
}: {
  trackSlug: string;
  unitSlug: string;
  challenge: LearnChallengeMeta;
  state: ChallengeState;
  companyName: string;
}) => {
  const { t } = useLingui();
  const fetcher = useFetcher();
  const started = Boolean(state.attemptId);

  return (
    <VStack spacing={4}>
      {state.passed && state.checkCount > 0 && <Celebration />}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            <HStack spacing={2} className="items-center">
              <LuFlaskConical /> {challenge.title}
              {challenge.capstone && (
                <Status color="purple">{t`Capstone`}</Status>
              )}
            </HStack>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <VStack spacing={4}>
            <p className="text-sm text-pretty">{challenge.brief}</p>

            <div className="rounded-lg border border-dashed border-border p-3">
              <span className="text-xs text-muted-foreground">
                {t`We will check the records you create in ${companyName}, from the moment you start.`}
              </span>
            </div>

            <VStack spacing={2}>
              {challenge.requirements.map((requirement) => {
                const isFailing = state.failedRequirement === requirement.key;
                const met =
                  state.passed ||
                  (state.checkCount > 0 &&
                    !isFailing &&
                    challenge.requirements.findIndex(
                      (r) => r.key === state.failedRequirement
                    ) > challenge.requirements.indexOf(requirement));
                return (
                  <VStack key={requirement.key} spacing={1}>
                    <HStack spacing={2} className="items-center">
                      <span
                        className={
                          met ? "text-emerald-500" : "text-muted-foreground"
                        }
                      >
                        {met ? <LuCircleCheck /> : <LuCircle />}
                      </span>
                      <span className="text-sm">{requirement.label}</span>
                    </HStack>
                    {isFailing && state.message && (
                      <span className="ml-6 text-sm text-destructive text-pretty">
                        {state.message}
                      </span>
                    )}
                  </VStack>
                );
              })}
            </VStack>

            {state.passed ? (
              <VStack spacing={2}>
                <Status color="green">{t`Verified`}</Status>
                {state.evidence && (
                  <span className="text-xs text-muted-foreground">
                    {t`Evidence recorded:`}{" "}
                    <span className="font-mono">
                      {Object.values(state.evidence)
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                )}
              </VStack>
            ) : (
              <HStack spacing={2}>
                {!started ? (
                  <fetcher.Form
                    method="post"
                    action={path.to.learnUnit(trackSlug, unitSlug)}
                  >
                    <input
                      type="hidden"
                      name="intent"
                      value="start-challenge"
                    />
                    <input
                      type="hidden"
                      name="challengeSlug"
                      value={challenge.slug}
                    />
                    <Button type="submit" size="lg">
                      {t`Start challenge`}
                    </Button>
                  </fetcher.Form>
                ) : (
                  <fetcher.Form
                    method="post"
                    action={path.to.learnUnit(trackSlug, unitSlug)}
                  >
                    <input
                      type="hidden"
                      name="intent"
                      value="check-challenge"
                    />
                    <input
                      type="hidden"
                      name="attemptId"
                      value={state.attemptId ?? ""}
                    />
                    <Button
                      type="submit"
                      size="lg"
                      isLoading={fetcher.state !== "idle"}
                    >
                      {t`Check my work`}
                    </Button>
                  </fetcher.Form>
                )}
              </HStack>
            )}
          </VStack>
        </CardContent>
      </Card>
    </VStack>
  );
};

const UnitRunner = ({
  trackSlug,
  trackTitle,
  unit,
  questions,
  quizResult,
  challenge,
  challengeState,
  companyName,
  completed
}: UnitRunnerProps) => {
  const { t } = useLingui();

  return (
    <div className="w-full max-w-3xl mx-auto p-8 pb-24">
      <VStack spacing={4}>
        <VStack spacing={2}>
          <Link
            to={path.to.learnTrack(trackSlug)}
            className="text-sm text-muted-foreground hover:underline"
          >
            {t`← ${trackTitle}`}
          </Link>
          <HStack spacing={3} className="items-center">
            <h1 className="text-2xl font-semibold tracking-tight text-balance">
              {unit.title}
            </h1>
            {completed && <Status color="green">{t`Complete`}</Status>}
          </HStack>
          <p className="text-muted-foreground text-pretty">{unit.objective}</p>
        </VStack>

        <DocsLinks unit={unit} />

        {quizResult ? (
          <QuizResult
            result={quizResult}
            trackSlug={trackSlug}
            unitSlug={unit.slug}
          />
        ) : questions ? (
          <QuizForm
            trackSlug={trackSlug}
            unitSlug={unit.slug}
            questions={questions}
          />
        ) : challenge && challengeState ? (
          <ChallengePanel
            trackSlug={trackSlug}
            unitSlug={unit.slug}
            challenge={challenge}
            state={challengeState}
            companyName={companyName}
          />
        ) : (
          <form method="post" action={path.to.learnUnit(trackSlug, unit.slug)}>
            <input type="hidden" name="intent" value="start-quiz" />
            <Button type="submit" size="lg">
              {t`Start the quiz`}
            </Button>
          </form>
        )}
      </VStack>
    </div>
  );
};

export default UnitRunner;
