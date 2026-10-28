// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The hub's small provenance controls: evidence (a live count of the records
// a step created), where a tick or row came from, and whether staff verified it.

import {
  Badge,
  cn,
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { LuBadgeCheck } from "react-icons/lu";
import type { CheckStateRow, Source } from "../../types";
import { useIsInternal, usePeopleById } from "../state";

// A live count with a link to the list it counts, e.g. "4 work centers". Shows
// nothing when there is no count, and a dash when the count could not be read
// (the viewer may have no permission for that module).
export function EvidenceCount({
  count,
  label,
  href,
  className
}: {
  count: number | null | undefined;
  label: string;
  href?: string;
  className?: string;
}) {
  if (count === undefined) return null;
  const text = count === null ? "–" : String(count);
  const body = (
    <Badge
      variant={count ? "secondary" : "outline"}
      className={cn("gap-1 tabular-nums font-normal", className)}
    >
      <span className="font-semibold">{text}</span>
      <span className="text-muted-foreground">{label}</span>
    </Badge>
  );
  return href ? (
    <a href={href} target="_blank" rel="noreferrer" className="shrink-0">
      {body}
    </a>
  ) : (
    <span className="shrink-0">{body}</span>
  );
}

// "Verified by …" when Carbon staff verified this tick. Nothing otherwise.
export function VerifiedBadge({
  row,
  className
}: {
  row: Pick<CheckStateRow, "verifiedAt" | "verifiedBy"> | undefined;
  className?: string;
}) {
  const { i18n } = useLingui();
  const peopleById = usePeopleById();
  if (!row?.verifiedAt) return null;
  const verifier = row.verifiedBy ? peopleById.get(row.verifiedBy) : undefined;
  // A day is enough here; the instant's UTC date is the stamp's date.
  const day = formatDate(row.verifiedAt.slice(0, 10), undefined, i18n.locale);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "shrink-0 inline-flex items-center gap-1 text-xxs font-medium text-emerald-600 dark:text-emerald-400",
            className
          )}
        >
          <LuBadgeCheck className="size-3.5" />
          <Trans>Verified</Trans>
        </span>
      </TooltipTrigger>
      <TooltipContent>
        {verifier ? (
          <Trans>
            Verified by {verifier.name} on {day}
          </Trans>
        ) : (
          <Trans>Verified by Carbon on {day}</Trans>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

// Where a row or tick came from, for anything other than a person in the app.
// The row sources a badge names; rows typed in the app carry none.
export const isSourceShown = (source: Source | null | undefined) =>
  source === "mcp" || source === "handover" || source === "interview";

export function SourceBadge({
  source,
  className
}: {
  source: Source | null | undefined;
  className?: string;
}) {
  const { t } = useLingui();
  const isInternal = useIsInternal();
  // Where a row came from helps Carbon staff; on a customer's page it is
  // noise, so only staff see it.
  if (!isInternal) return null;
  const label =
    source === "mcp"
      ? t`From AI agent`
      : source === "handover"
        ? t`From handover`
        : source === "interview"
          ? t`From interview`
          : null;
  if (!label) return null;
  return (
    <Badge variant="outline" className={cn("shrink-0 font-normal", className)}>
      {label}
    </Badge>
  );
}
