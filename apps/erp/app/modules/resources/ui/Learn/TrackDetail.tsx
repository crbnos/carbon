import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  HStack,
  Status,
  VStack
} from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import {
  LuAward,
  LuCircle,
  LuCircleCheck,
  LuFlaskConical,
  LuLock
} from "react-icons/lu";
import { Link } from "react-router";
import { path } from "~/utils/path";
import type { LearnTrack } from "../../learn";

export type ExamGate =
  | { state: "locked"; missing: string[] }
  | { state: "cooldown"; until: string }
  | { state: "ready" }
  | { state: "certified"; certificateId: string; expiresAt: string };

export type TrackDetailProps = {
  track: LearnTrack;
  completedUnits: string[];
  earnedBadges: string[];
  examGate: ExamGate;
  canRenew: boolean;
  locale?: string;
};

const TrackDetail = ({
  track,
  completedUnits,
  earnedBadges,
  examGate,
  canRenew,
  locale
}: TrackDetailProps) => {
  const { t } = useLingui();
  const done = new Set(completedUnits);
  const badges = new Set(earnedBadges);

  const challengeTitle = (slug: string) =>
    track.challenges.find((c) => c.slug === slug)?.title ?? slug;

  return (
    <div className="w-full max-w-4xl mx-auto p-8">
      <VStack spacing={2} className="mb-8">
        <Link
          to={path.to.learn}
          className="text-sm text-muted-foreground hover:underline"
        >
          {t`← All tracks`}
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight text-balance">
          {track.title}
        </h1>
        <p className="text-muted-foreground">{track.description}</p>
      </VStack>

      <VStack spacing={4}>
        {track.modules.map((module) => (
          <Card key={module.slug}>
            <CardHeader>
              <HStack className="w-full justify-between items-center">
                <VStack spacing={0}>
                  <CardTitle>{module.title}</CardTitle>
                  <span className="text-sm text-muted-foreground">
                    {module.description}
                  </span>
                </VStack>
                {badges.has(module.badgeSlug) && (
                  <Badge variant="green">
                    <HStack spacing={1} className="items-center">
                      <LuAward /> {module.badgeTitle}
                    </HStack>
                  </Badge>
                )}
              </HStack>
            </CardHeader>
            <CardContent>
              <VStack spacing={0} className="divide-y divide-border">
                {module.units.map((unit) => {
                  const complete = done.has(unit.slug);
                  return (
                    <Link
                      key={unit.slug}
                      to={path.to.learnUnit(track.slug, unit.slug)}
                      prefetch="intent"
                      className="w-full flex items-center gap-3 py-3 group"
                    >
                      <span
                        className={
                          complete
                            ? "text-emerald-500"
                            : "text-muted-foreground"
                        }
                      >
                        {complete ? <LuCircleCheck /> : <LuCircle />}
                      </span>
                      <VStack spacing={0} className="flex-1">
                        <span className="text-sm font-medium group-hover:underline">
                          {unit.title}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {unit.objective}
                        </span>
                      </VStack>
                      <HStack spacing={2} className="items-center shrink-0">
                        {unit.assessment.kind === "challenge" && (
                          <Badge variant="secondary">
                            <HStack spacing={1} className="items-center">
                              <LuFlaskConical /> {t`Hands-on`}
                            </HStack>
                          </Badge>
                        )}
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {t`${unit.estimatedMinutes} min`}
                        </span>
                      </HStack>
                    </Link>
                  );
                })}
              </VStack>
            </CardContent>
          </Card>
        ))}

        <Card>
          <CardHeader>
            <CardTitle>{t`Certification exam`}</CardTitle>
            <span className="text-sm text-muted-foreground">
              {t`${track.exam.questionCount} scenario questions, ${track.exam.timeLimitMinutes} minutes, one question at a time. You need 80% to pass.`}
            </span>
          </CardHeader>
          <CardContent>
            {examGate.state === "locked" && (
              <VStack spacing={3}>
                <HStack
                  spacing={2}
                  className="items-center text-muted-foreground"
                >
                  <LuLock />
                  <span className="text-sm">
                    {t`Complete these hands-on challenges first:`}
                  </span>
                </HStack>
                <VStack spacing={1}>
                  {examGate.missing.map((slug) => (
                    <span key={slug} className="text-sm">
                      • {challengeTitle(slug)}
                    </span>
                  ))}
                </VStack>
              </VStack>
            )}

            {examGate.state === "cooldown" && (
              <VStack spacing={2}>
                <Status color="orange">{t`Cooling down`}</Status>
                <span className="text-sm text-muted-foreground">
                  {t`You can retake the exam after ${formatDate(examGate.until.slice(0, 10), undefined, locale)}. Use the time to revisit the units you found hardest.`}
                </span>
              </VStack>
            )}

            {examGate.state === "ready" && (
              <Button size="lg" asChild>
                <Link
                  to={path.to.learnExam(track.slug)}
                >{t`Start the exam`}</Link>
              </Button>
            )}

            {examGate.state === "certified" && (
              <VStack spacing={3}>
                <Status color="green">
                  {t`Certified until ${formatDate(examGate.expiresAt.slice(0, 10), undefined, locale)}`}
                </Status>
                <HStack spacing={2}>
                  <Button variant="secondary" asChild>
                    <Link
                      to={path.to.file.learnCertificate(examGate.certificateId)}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {t`Download certificate`}
                    </Link>
                  </Button>
                  {canRenew && (
                    <Button asChild>
                      <Link
                        to={path.to.learnRenew(track.slug)}
                      >{t`Renew now`}</Link>
                    </Button>
                  )}
                </HStack>
              </VStack>
            )}
          </CardContent>
        </Card>
      </VStack>
    </div>
  );
};

export default TrackDetail;
