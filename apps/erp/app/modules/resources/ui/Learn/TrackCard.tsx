import {
  BarProgress,
  Card,
  CardContent,
  HStack,
  Status,
  VStack
} from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import { LuGraduationCap } from "react-icons/lu";
import { Link } from "react-router";
import { path } from "~/utils/path";
import type { LearnTrack } from "../../learn";

export type TrackCardState = {
  percent: number;
  certified: boolean;
  expiresAt: string | null;
  revoked: boolean;
  dueDate: string | null;
};

type TrackCardProps = {
  track: LearnTrack;
  state: TrackCardState;
  locale?: string;
};

const TrackCard = ({ track, state, locale }: TrackCardProps) => {
  const { t } = useLingui();
  const isLive = track.status === "live";

  const statusPill = () => {
    if (!isLive) return <Status color="gray">{t`Coming soon`}</Status>;
    if (state.revoked) return <Status color="red">{t`Revoked`}</Status>;
    if (state.certified)
      return (
        <Status color="green">
          {state.expiresAt
            ? t`Certified until ${formatDate(state.expiresAt.slice(0, 10), undefined, locale)}`
            : t`Certified`}
        </Status>
      );
    if (state.percent > 0)
      return <Status color="yellow">{t`In progress`}</Status>;
    return <Status color="gray">{t`Not started`}</Status>;
  };

  const body = (
    <CardContent className="p-5">
      <VStack spacing={4}>
        <HStack className="w-full justify-between items-start gap-4">
          <div className="shrink-0 size-11 flex items-center justify-center rounded-full border border-border bg-primary/10 text-primary text-xl">
            <LuGraduationCap />
          </div>
          {statusPill()}
        </HStack>
        <VStack spacing={1}>
          <span className="text-base font-semibold tracking-tight">
            {track.title}
          </span>
          <span className="text-sm text-muted-foreground">
            {track.description}
          </span>
          <span className="text-xs text-muted-foreground">
            {track.audience}
          </span>
        </VStack>
        {isLive && (
          <BarProgress progress={state.percent} value={`${state.percent}%`} />
        )}
        {state.dueDate && (
          <span className="text-xs text-muted-foreground">
            {t`Due ${formatDate(state.dueDate, undefined, locale)}`}
          </span>
        )}
      </VStack>
    </CardContent>
  );

  if (!isLive) {
    return <Card className="opacity-60">{body}</Card>;
  }

  return (
    <Link
      to={path.to.learnTrack(track.slug)}
      prefetch="intent"
      className="group"
    >
      <Card className="h-full transition-colors group-hover:border-foreground/20">
        {body}
      </Card>
    </Link>
  );
};

export default TrackCard;
