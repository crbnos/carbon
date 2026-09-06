import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  cn,
  HStack,
  RadioGroup,
  RadioGroupItem,
  Status,
  useInterval,
  VStack
} from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { LuExternalLink, LuLock } from "react-icons/lu";
import { Link } from "react-router";
import type { LearnServedQuestion } from "~/modules/resources";
import { path } from "~/utils/path";
import Celebration from "./Celebration";

export type ExamResultData = {
  passed: boolean;
  correctCount: number;
  questionCount: number;
  perTopic: Array<{ topic: string; correct: number; total: number }>;
  certificateId: string | null;
};

type ExamRunnerProps = {
  trackSlug: string;
  trackTitle: string;
  mode: "exam" | "renewal";
  questionCount: number;
  timeLimitMinutes: number;
  /** null when the exam has not been started yet */
  current: {
    attemptId: string;
    question: LearnServedQuestion;
    index: number;
    total: number;
    expiresAt: string | null;
  } | null;
  result: ExamResultData | null;
  gate:
    | { reason: "challenges"; missing: string[] }
    | { reason: "cooldown"; until: string }
    | null;
  verifyUrl: string | null;
};

const Countdown = ({ expiresAt }: { expiresAt: string }) => {
  const { t } = useLingui();
  const [remaining, setRemaining] = useState(
    () => new Date(expiresAt).getTime() - Date.now()
  );

  useInterval(() => {
    setRemaining(new Date(expiresAt).getTime() - Date.now());
  }, 1000);

  const clamped = Math.max(remaining, 0);
  const minutes = Math.floor(clamped / 60000);
  const seconds = Math.floor((clamped % 60000) / 1000);
  const urgent = clamped < 5 * 60 * 1000;

  return (
    <span
      className={cn(
        "text-sm font-mono tabular-nums",
        urgent ? "text-destructive font-semibold" : "text-muted-foreground"
      )}
      aria-label={t`Time remaining`}
    >
      {minutes}:{String(seconds).padStart(2, "0")}
    </span>
  );
};

const ProgressDots = ({ index, total }: { index: number; total: number }) => (
  <div className="flex flex-wrap gap-1" aria-hidden="true">
    {Array.from({ length: total }, (_, i) => (
      <div
        key={i}
        className={cn(
          "size-2 rounded-full",
          i < index ? "bg-primary" : i === index ? "bg-primary/50" : "bg-muted"
        )}
      />
    ))}
  </div>
);

const ExamRunner = ({
  trackSlug,
  trackTitle,
  mode,
  questionCount,
  timeLimitMinutes,
  current,
  result,
  gate,
  verifyUrl
}: ExamRunnerProps) => {
  const { t } = useLingui();
  const [selected, setSelected] = useState<string | string[]>("");
  const action =
    mode === "renewal"
      ? path.to.learnRenew(trackSlug)
      : path.to.learnExam(trackSlug);

  if (result) {
    return (
      <div className="w-full max-w-2xl mx-auto p-8">
        {result.passed && <Celebration />}
        <VStack spacing={4}>
          <Card>
            <CardContent className="p-8">
              <VStack spacing={4} className="items-center text-center">
                <span
                  className={cn(
                    "text-6xl font-mono font-bold tabular-nums",
                    result.passed ? "text-emerald-500" : "text-destructive"
                  )}
                >
                  {Math.floor(
                    (result.correctCount / result.questionCount) * 100
                  )}
                  %
                </span>
                <span className="text-sm text-muted-foreground tabular-nums">
                  {t`${result.correctCount} of ${result.questionCount} correct`}
                </span>
                {result.passed ? (
                  <Status color="green">
                    {mode === "renewal" ? t`Certificate renewed` : t`Certified`}
                  </Status>
                ) : (
                  <VStack spacing={2} className="items-center">
                    <Status color="orange">{t`Not passed`}</Status>
                    <span className="text-sm text-muted-foreground max-w-md text-pretty">
                      {t`You need 80% to certify. Your per-topic scores are below — revisit the weakest ones, then come back when the cooldown ends.`}
                    </span>
                  </VStack>
                )}
              </VStack>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">{t`By topic`}</CardTitle>
            </CardHeader>
            <CardContent>
              <VStack spacing={3}>
                {result.perTopic.map((topic) => (
                  <HStack key={topic.topic} className="w-full justify-between">
                    <span className="text-sm capitalize">{topic.topic}</span>
                    <span className="text-sm font-mono tabular-nums text-muted-foreground">
                      {topic.correct}/{topic.total}
                    </span>
                  </HStack>
                ))}
              </VStack>
            </CardContent>
          </Card>

          <HStack spacing={2}>
            {result.certificateId && (
              <Button asChild>
                <Link
                  to={path.to.file.learnCertificate(result.certificateId)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {t`Download certificate`}
                </Link>
              </Button>
            )}
            {verifyUrl && (
              <Button variant="secondary" asChild>
                <a href={verifyUrl} target="_blank" rel="noopener noreferrer">
                  <HStack spacing={2} className="items-center">
                    {t`Verification page`} <LuExternalLink />
                  </HStack>
                </a>
              </Button>
            )}
            <Button variant="secondary" asChild>
              <Link
                to={path.to.learnTrack(trackSlug)}
              >{t`Back to the track`}</Link>
            </Button>
          </HStack>
        </VStack>
      </div>
    );
  }

  if (gate) {
    return (
      <div className="w-full max-w-2xl mx-auto p-8">
        <Card>
          <CardHeader>
            <CardTitle>
              <HStack spacing={2} className="items-center">
                <LuLock /> {t`Not yet`}
              </HStack>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <VStack spacing={3}>
              {gate.reason === "challenges" ? (
                <span className="text-sm text-muted-foreground">
                  {t`Finish the track's hands-on challenges before sitting the exam.`}
                </span>
              ) : (
                <span className="text-sm text-muted-foreground">
                  {t`You can retake the exam after ${gate.until.slice(0, 10)}.`}
                </span>
              )}
              <Button variant="secondary" asChild>
                <Link
                  to={path.to.learnTrack(trackSlug)}
                >{t`Back to the track`}</Link>
              </Button>
            </VStack>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!current) {
    return (
      <div className="w-full max-w-2xl mx-auto p-8">
        <Card>
          <CardHeader>
            <CardTitle>
              {mode === "renewal"
                ? t`Renew your certificate`
                : t`${trackTitle} certification`}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form method="post" action={action}>
              <input type="hidden" name="intent" value="start" />
              <input type="hidden" name="trackSlug" value={trackSlug} />
              <VStack spacing={4}>
                <VStack spacing={2}>
                  <span className="text-sm text-muted-foreground">
                    {mode === "renewal"
                      ? t`A short open-book check on what has changed. Passing extends your certificate by 12 months.`
                      : t`${questionCount} scenario questions, ${timeLimitMinutes} minutes. One question at a time, and you cannot go back. You need 80% to pass.`}
                  </span>
                </VStack>

                <label className="flex items-start gap-3 rounded-lg border border-border p-4 cursor-pointer">
                  <Checkbox name="honorAccepted" value="on" />
                  <span className="text-sm text-pretty">
                    {t`I will answer on my own, without help from another person or from anyone else's answers.`}
                  </span>
                </label>

                <Button type="submit" size="lg">
                  {mode === "renewal"
                    ? t`Start the renewal quiz`
                    : t`Start the exam`}
                </Button>
              </VStack>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  const question = current.question;
  const answered = Array.isArray(selected)
    ? selected.length > 0
    : Boolean(selected);

  return (
    <div className="w-full max-w-2xl mx-auto p-8">
      <VStack spacing={4}>
        <HStack className="w-full justify-between items-center">
          <span className="text-sm text-muted-foreground tabular-nums">
            {t`Question ${current.index + 1} of ${current.total}`}
          </span>
          {current.expiresAt && <Countdown expiresAt={current.expiresAt} />}
        </HStack>

        <ProgressDots index={current.index} total={current.total} />

        <Card>
          <CardHeader>
            <CardTitle className="text-lg font-medium text-pretty">
              {question.prompt}
            </CardTitle>
            {question.kind === "multi" && (
              <span className="text-xs text-muted-foreground">
                {t`Choose all that apply`}
              </span>
            )}
          </CardHeader>
          <CardContent>
            <form method="post" action={action} key={question.slug}>
              <input type="hidden" name="intent" value="answer" />
              <input type="hidden" name="attemptId" value={current.attemptId} />
              <input type="hidden" name="questionSlug" value={question.slug} />
              {Array.isArray(selected) ? (
                selected.map((id) => (
                  <input key={id} type="hidden" name="selected" value={id} />
                ))
              ) : (
                <input type="hidden" name="selected" value={selected} />
              )}

              <VStack spacing={4}>
                {question.kind === "multi" ? (
                  <VStack spacing={2}>
                    {question.options.map((option) => (
                      <label
                        key={option.id}
                        className="flex items-start gap-3 rounded-lg border border-border p-3 cursor-pointer hover:border-foreground/20"
                      >
                        <Checkbox
                          checked={
                            Array.isArray(selected) &&
                            selected.includes(option.id)
                          }
                          onCheckedChange={() =>
                            setSelected((prev) => {
                              const list = Array.isArray(prev) ? prev : [];
                              return list.includes(option.id)
                                ? list.filter((id) => id !== option.id)
                                : [...list, option.id];
                            })
                          }
                        />
                        <span className="text-sm">{option.text}</span>
                      </label>
                    ))}
                  </VStack>
                ) : (
                  <RadioGroup
                    value={typeof selected === "string" ? selected : ""}
                    onValueChange={(value) => setSelected(value)}
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

                <Button type="submit" size="lg" isDisabled={!answered}>
                  {current.index + 1 === current.total ? t`Finish` : t`Next`}
                </Button>
                <span className="text-xs text-muted-foreground">
                  {t`You cannot return to a question once you answer it.`}
                </span>
              </VStack>
            </form>
          </CardContent>
        </Card>
      </VStack>
    </div>
  );
};

export default ExamRunner;
