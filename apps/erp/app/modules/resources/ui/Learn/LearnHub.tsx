import {
  Badge,
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
import { LuAward, LuBadgeCheck, LuFlaskConical } from "react-icons/lu";
import { Link } from "react-router";
import { Empty, Hyperlink } from "~/components";
import { path } from "~/utils/path";
import type { LearnTrack } from "../../learn";
import ActivityHeatmap from "./ActivityHeatmap";
import LevelPanel from "./LevelPanel";
import type { TrackCardState } from "./TrackCard";
import TrackCard from "./TrackCard";
import WeeklyGoalRing from "./WeeklyGoalRing";

export type LearnHubProps = {
  tracks: LearnTrack[];
  trackState: Record<string, TrackCardState>;
  totalXp: number;
  weekXp: number;
  goalXp: number;
  streak: number;
  badges: Array<{ badgeSlug: string; awardedAt: string }>;
  badgeTitles: Record<string, string>;
  certificates: Array<{
    id: string;
    trackTitle: string;
    issuedAt: string;
    expiresAt: string;
    revokedAt: string | null;
  }>;
  activity: Array<{ day: string; xp: number }>;
  today: string;
  companyName: string;
  locale?: string;
};

const LearnHub = ({
  tracks,
  trackState,
  totalXp,
  weekXp,
  goalXp,
  streak,
  badges,
  badgeTitles,
  certificates,
  activity,
  today,
  companyName,
  locale
}: LearnHubProps) => {
  const { t } = useLingui();

  const emptyState: TrackCardState = {
    percent: 0,
    certified: false,
    expiresAt: null,
    revoked: false,
    dueDate: null
  };

  return (
    <div className="w-full max-w-7xl mx-auto p-8">
      <VStack spacing={2} className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight text-balance">
          {t`Learn Carbon`}
        </h1>
        <p className="text-muted-foreground max-w-2xl">
          {t`Work through a track, prove it on real work in Carbon, and earn a certificate your manager can verify.`}
        </p>
      </VStack>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 order-last lg:order-first">
          <VStack spacing={4}>
            <Card>
              <CardContent className="p-5">
                <VStack spacing={4} className="items-center">
                  <WeeklyGoalRing
                    weekXp={weekXp}
                    goalXp={goalXp}
                    streak={streak}
                  />
                  <LevelPanel totalXp={totalXp} badgeCount={badges.length} />
                  <Hyperlink to={path.to.learnPreferences}>
                    <span className="text-xs text-muted-foreground">
                      {t`Change weekly goal`}
                    </span>
                  </Hyperlink>
                </VStack>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium">{t`Activity`}</CardTitle>
              </CardHeader>
              <CardContent>
                <ActivityHeatmap days={activity} today={today} />
                <p className="mt-3 text-xs text-muted-foreground">
                  {t`Only you can see your activity, XP, and streak.`}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium">
                  <HStack spacing={2} className="items-center">
                    <LuAward /> {t`Badges`}
                  </HStack>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {badges.length === 0 ? (
                  <Empty>
                    <span className="text-xs text-muted-foreground">
                      {t`Finish a module to earn your first badge`}
                    </span>
                  </Empty>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {badges.map((badge) => (
                      <Badge key={badge.badgeSlug} variant="secondary">
                        {badgeTitles[badge.badgeSlug] ?? badge.badgeSlug}
                      </Badge>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium">
                  <HStack spacing={2} className="items-center">
                    <LuBadgeCheck /> {t`Certificates`}
                  </HStack>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {certificates.length === 0 ? (
                  <Empty>
                    <span className="text-xs text-muted-foreground">
                      {t`Pass a track's exam to earn a certificate`}
                    </span>
                  </Empty>
                ) : (
                  <VStack spacing={3}>
                    {certificates.map((certificate) => (
                      <HStack
                        key={certificate.id}
                        className="w-full justify-between items-center"
                      >
                        <VStack spacing={0}>
                          <Link
                            to={path.to.file.learnCertificate(certificate.id)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm font-medium hover:underline"
                          >
                            {certificate.trackTitle}
                          </Link>
                          <span className="text-xs text-muted-foreground">
                            {t`Expires ${formatDate(certificate.expiresAt.slice(0, 10), undefined, locale)}`}
                          </span>
                        </VStack>
                        {certificate.revokedAt ? (
                          <Status color="red">{t`Revoked`}</Status>
                        ) : certificate.expiresAt.slice(0, 10) < today ? (
                          <Status color="red">{t`Expired`}</Status>
                        ) : (
                          <Status color="green">{t`Active`}</Status>
                        )}
                      </HStack>
                    ))}
                  </VStack>
                )}
              </CardContent>
            </Card>
          </VStack>
        </div>

        <div className="lg:col-span-2">
          <VStack spacing={4}>
            <Card className="border-dashed">
              <CardContent className="p-4">
                <HStack spacing={3} className="items-start">
                  <div className="shrink-0 mt-0.5 text-muted-foreground">
                    <LuFlaskConical />
                  </div>
                  <VStack spacing={1}>
                    <span className="text-sm font-medium">
                      {t`Hands-on checks run in ${companyName}`}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {t`Challenges look at real records you create here. If you would rather not add practice data to this company, ask an admin to set up a demo company from Settings → Demo Data and switch to it first.`}
                    </span>
                  </VStack>
                </HStack>
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {tracks.map((track) => (
                <TrackCard
                  key={track.slug}
                  track={track}
                  state={trackState[track.slug] ?? emptyState}
                  locale={locale}
                />
              ))}
            </div>
          </VStack>
        </div>
      </div>
    </div>
  );
};

export default LearnHub;
