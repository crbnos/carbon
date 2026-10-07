// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  cn,
  useViewport
} from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { LuArrowUpRight, LuChevronRight } from "react-icons/lu";
import { Link } from "react-router";

type MetricCardProps = {
  title: ReactNode;
  value: ReactNode;
  icon?: ReactNode;
  to?: string;
  linkLabel?: string;
  description?: ReactNode;
  className?: string;
};

const MetricCard = ({
  title,
  value,
  icon,
  to,
  linkLabel,
  description,
  className
}: MetricCardProps) => {
  const { t } = useLingui();
  const { isPhone } = useViewport();
  // Compact: the whole tile is the link, so no View button.
  // The link is then the grid item, so it takes the caller's layout classes.
  const isLinkTile = isPhone && !!to;

  const card = (
    <Card className={cn(!isLinkTile && className, "max-md:h-full")}>
      <CardHeader className="flex-row items-center gap-2">
        {icon && (
          <span className="flex-shrink-0 text-muted-foreground">{icon}</span>
        )}
        <CardTitle
          className={cn(
            "flex-1 min-w-0 line-clamp-none",
            // Phones: two lines, so similar labels stay distinguishable; always two
            // lines tall, so values line up across a row of tiles.
            isPhone ? "line-clamp-2 min-h-[2lh] text-[13px]" : "truncate"
          )}
        >
          {title}
        </CardTitle>
        {to && !isLinkTile && (
          <Button
            aria-label={linkLabel}
            asChild
            variant="secondary"
            size="sm"
            rightIcon={<LuArrowUpRight />}
            className="flex-shrink-0 -my-1"
          >
            <Link to={to}>{t`View`}</Link>
          </Button>
        )}
        {/* The View button's place on a link tile: the whole tile opens. */}
        {isLinkTile && (
          <LuChevronRight className="size-4 shrink-0 text-muted-foreground" />
        )}
      </CardHeader>
      <CardContent>
        <h3 className="text-4xl font-medium tracking-tighter tabular-nums truncate max-md:text-[26px] max-md:font-semibold max-md:tracking-tight">
          {value}
        </h3>
        {description && (
          <span className="text-xs text-muted-foreground">{description}</span>
        )}
      </CardContent>
    </Card>
  );

  if (isLinkTile && to) {
    return (
      <Link
        to={to}
        className={cn(
          "block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          className
        )}
      >
        {card}
      </Link>
    );
  }

  return card;
};

export default MetricCard;
