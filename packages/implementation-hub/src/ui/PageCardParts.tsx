// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Parts of a page card shared by the page and its staff editor.

import { Badge, Checkbox } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useMemo } from "react";
import { CUSTOMIZATION_STATUSES } from "../content/customization";
import { readCustomization } from "../logic/customization";
import {
  cardChecklists,
  checklistProgress,
  type PageCard
} from "../logic/page";
import {
  priorityProgress,
  priorityStateFromFields
} from "../logic/priority-set";
import type { ImplementationRowData } from "../types";
import { CUSTOMIZATION_STATUS_VARIANTS, StatusToggle } from "./primitives";
import {
  useCheckMap,
  useFieldMap,
  useHubActions,
  useIsInternal
} from "./state";

// The card's state control: a toggle for anything it ticks, the status of a
// customization (Carbon staff change that), nothing for training. A card
// with a checklist is marked done by its person once every point is ticked;
// Carbon staff mark it either way.
export function CardStatus({
  card,
  on,
  row,
  memberId
}: {
  card: PageCard;
  on: boolean;
  row: ImplementationRowData | undefined;
  memberId: string;
}) {
  const { t, i18n } = useLingui();
  const actions = useHubActions();
  const states = useCheckMap();
  const isInternal = useIsInternal();
  const points = checklistProgress(cardChecklists(card, memberId), states);
  const blocked =
    !isInternal && !on && points.total > 0 && points.ticked < points.total;

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
      isDisabled={blocked}
      title={blocked ? t`Tick every point of the checklist first` : undefined}
      onToggle={() =>
        actions.setCheck(tick.itemKey, tick.kind, on ? tick.off : tick.on)
      }
    />
  );
}

// The fields Carbon staff added to a card: each value under its label, and
// each checklist with a box per point that its person ticks.
export function CardFieldsView({
  card,
  memberId
}: {
  card: PageCard;
  memberId: string;
}) {
  const actions = useHubActions();
  const states = useCheckMap();
  const values = (card.fields ?? []).flatMap((field) =>
    "value" in field ? [field] : []
  );
  const checklists = cardChecklists(card, memberId);
  if (values.length === 0 && checklists.length === 0) return null;

  return (
    <div className="flex flex-col gap-4">
      {values.length ? (
        <dl className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-[minmax(0,10rem)_1fr]">
          {values.map((field, index) => (
            <div key={`${field.label}-${index}`} className="contents">
              <dt className="text-xs font-medium text-muted-foreground">
                {field.label}
              </dt>
              <dd className="text-sm whitespace-pre-line text-pretty">
                {field.value}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {checklists.map((checklist, index) => {
        const progress = checklistProgress([checklist], states);
        return (
          <fieldset
            key={`${checklist.label}-${index}`}
            className="flex flex-col gap-2"
          >
            <legend className="mb-1 flex w-full items-baseline justify-between gap-2 text-xs font-medium text-muted-foreground">
              <span>{checklist.label}</span>
              <span className="tabular-nums">
                {progress.ticked}/{progress.total}
              </span>
            </legend>
            {checklist.points.map((point) => {
              const ticked = states.get(point.itemKey) === "1";
              return (
                <label
                  key={point.itemKey}
                  className="flex cursor-pointer items-start gap-2 text-sm"
                >
                  <Checkbox
                    className="mt-0.5"
                    isChecked={ticked}
                    onCheckedChange={(checked) =>
                      actions.setCheck(
                        point.itemKey,
                        "check",
                        checked === true ? "1" : "0"
                      )
                    }
                  />
                  <span
                    className={
                      ticked ? "text-muted-foreground line-through" : undefined
                    }
                  >
                    {point.text}
                  </span>
                </label>
              );
            })}
          </fieldset>
        );
      })}
    </div>
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
