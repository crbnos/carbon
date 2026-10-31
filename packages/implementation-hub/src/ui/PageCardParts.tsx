// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Parts of a page card shared by the page and its staff editor.

import { Badge } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useMemo } from "react";
import { CUSTOMIZATION_STATUSES } from "../content/customization";
import { readCustomization } from "../logic/customization";
import type { PageCard } from "../logic/page";
import {
  priorityProgress,
  priorityStateFromFields
} from "../logic/priority-set";
import type { ImplementationRowData } from "../types";
import { CUSTOMIZATION_STATUS_VARIANTS, StatusToggle } from "./primitives";
import { useFieldMap, useHubActions } from "./state";

// The card's state control: a toggle for anything it ticks, the status of a
// customization (Carbon staff change that), nothing for training.
export function CardStatus({
  card,
  on,
  row
}: {
  card: PageCard;
  on: boolean;
  row: ImplementationRowData | undefined;
}) {
  const { t, i18n } = useLingui();
  const actions = useHubActions();

  if (card.kind === "customization" && row) {
    const status = readCustomization(row.payload).status;
    return (
      <Badge
        variant={CUSTOMIZATION_STATUS_VARIANTS[status]}
        className="shrink-0"
      >
        {i18n._(CUSTOMIZATION_STATUSES[status])}
      </Badge>
    );
  }
  const tick = card.tick;
  if (!tick || card.missing) return null;

  // A decision is in or out of scope; everything else is to do or done.
  const labels =
    tick.meaning === "scope"
      ? { on: t`In scope`, off: t`Out of scope` }
      : { on: t`Done`, off: t`To do` };

  return (
    <StatusToggle
      active={on}
      activeLabel={labels.on}
      inactiveLabel={labels.off}
      withIcon={tick.meaning === "done"}
      onToggle={() =>
        actions.setCheck(tick.itemKey, tick.kind, on ? tick.off : tick.on)
      }
    />
  );
}

// How far the company is through the priority set questionnaire.
export function PriorityProgress() {
  const fields = useFieldMap();
  const { answered, total } = useMemo(
    () => priorityProgress(priorityStateFromFields(fields)),
    [fields]
  );
  return (
    <p className="text-xs text-muted-foreground">
      <Trans>
        {answered} of {total} questions answered
      </Trans>
    </p>
  );
}

// In place of the cards of a section that has none: the section stays on the
// page until staff remove it.
export function EmptySection() {
  return (
    <div className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
      <Trans>Nothing in this section yet.</Trans>
    </div>
  );
}
