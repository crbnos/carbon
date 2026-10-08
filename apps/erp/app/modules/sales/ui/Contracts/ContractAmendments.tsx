// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  HStack,
  VStack
} from "@carbon/react";
import { equals } from "@carbon/utils";
import { parseDate } from "@internationalized/date";
import { Trans, useLingui } from "@lingui/react/macro";
import { DateTime } from "~/components";
import {
  useCurrencyFormatter,
  useDateFormatter,
  usePercentFormatter,
  useQuantityFormatter
} from "~/hooks";
import type {
  ContractAmendment,
  ContractLine,
  ContractRouteData
} from "./types";
import { useContractLabels } from "./useContractLabels";

type ContractAmendmentsProps = Pick<
  ContractRouteData,
  "contract" | "lines" | "amendments"
>;

/** What a cancellation changed, stored on its amendment so it can be
 *  reverted (`post-customer-contract`, plan decision 11). */
type PreviousState = {
  lineEndDates: Record<string, string | null>;
};

function previousStateOf(amendment: ContractAmendment): PreviousState | null {
  const value = amendment.previousState;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const { lineEndDates } = value as Record<string, unknown>;
  if (typeof lineEndDates !== "object" || lineEndDates === null) return null;
  return { lineEndDates: lineEndDates as Record<string, string | null> };
}

const dayBefore = (date: string) =>
  parseDate(date).subtract({ days: 1 }).toString();

/** The contract's amendment history, newest first: when each took effect, how,
 *  its type and reason, and what it did to the lines — a replaced line with
 *  the fields its replacement changed, an added line, an ended line. */
const ContractAmendments = ({
  contract,
  lines,
  amendments
}: ContractAmendmentsProps) => {
  const labels = useContractLabels();
  const { currencyCode } = contract;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans>Amendments</Trans>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {amendments.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {contract.status === "Draft" ? (
              <Trans>
                A Draft's lines are edited directly. Once confirmed, changes are
                made with Amend and recorded here.
              </Trans>
            ) : (
              <Trans>No amendments.</Trans>
            )}
          </p>
        ) : (
          <VStack spacing={0} className="w-full">
            {[...amendments].reverse().map((amendment) => (
              <AmendmentEntry
                key={amendment.id}
                amendment={amendment}
                lines={lines}
                contractTypeLabel={labels.contractType[amendment.contractType]}
                currencyCode={currencyCode}
              />
            ))}
          </VStack>
        )}
      </CardContent>
    </Card>
  );
};

function AmendmentEntry({
  amendment,
  lines,
  contractTypeLabel,
  currencyCode
}: {
  amendment: ContractAmendment;
  lines: ContractLine[];
  contractTypeLabel: string;
  currencyCode: string;
}) {
  const { t } = useLingui();
  const { formatDate } = useDateFormatter();
  const formatQuantity = useQuantityFormatter();
  const percent = usePercentFormatter();
  const rateFormatter = useCurrencyFormatter({
    currency: currencyCode,
    rate: true
  });

  const lineById = new Map(lines.map((line) => [line.id, line]));
  const nameOf = (line: ContractLine) =>
    line.description || line.item?.name || line.itemId;
  const perUnit: Record<NonNullable<ContractLine["rateUnit"]>, string> = {
    Day: t`per day`,
    Week: t`per week`,
    Month: t`per month`,
    Quarter: t`per quarter`,
    Year: t`per year`
  };
  const revenueMethodLabels: Record<ContractLine["revenueMethod"], string> = {
    Daily: t`Daily`,
    "Even Period": t`Even Period`
  };
  const effectLabel =
    amendment.effect === "Next Period"
      ? t`From the next billing period`
      : t`From the change date`;
  const rateOf = (line: ContractLine) => {
    const rate = rateFormatter.format(Number(line.rate));
    return line.rateUnit ? `${rate} ${perUnit[line.rateUnit]}` : rate;
  };

  // The lines this amendment wrote: replacements carry `amendsLineId`.
  const written = amendment.customerContractLine
    .map((embedded) => lineById.get(embedded.id))
    .filter((line): line is ContractLine => !!line);
  const replacedIds = new Set(
    written.flatMap((line) => (line.amendsLineId ? [line.amendsLineId] : []))
  );

  const changes: string[] = [];
  for (const line of written) {
    const before = line.amendsLineId ? lineById.get(line.amendsLineId) : null;
    if (!before) {
      const name = nameOf(line);
      const quantity = formatQuantity(Number(line.quantity));
      const rate = rateOf(line);
      changes.push(t`Added ${name} · ${quantity} × ${rate}`);
      continue;
    }
    const fields: string[] = [];
    if (!equals(Number(before.quantity), Number(line.quantity))) {
      const was = formatQuantity(Number(before.quantity));
      const now = formatQuantity(Number(line.quantity));
      fields.push(t`quantity ${was} → ${now}`);
    }
    if (
      !equals(Number(before.rate), Number(line.rate)) ||
      before.rateUnit !== line.rateUnit
    ) {
      const was = rateOf(before);
      const now = rateOf(line);
      fields.push(t`rate ${was} → ${now}`);
    }
    if (!equals(Number(before.discountPercent), Number(line.discountPercent))) {
      const was = percent.format(Number(before.discountPercent));
      const now = percent.format(Number(line.discountPercent));
      fields.push(t`discount ${was} → ${now}`);
    }
    if (!equals(Number(before.taxPercent), Number(line.taxPercent))) {
      const was = percent.format(Number(before.taxPercent));
      const now = percent.format(Number(line.taxPercent));
      fields.push(t`tax ${was} → ${now}`);
    }
    if ((before.description ?? "") !== (line.description ?? "")) {
      fields.push(t`description changed`);
    }
    if (before.revenueMethod !== line.revenueMethod) {
      const was = revenueMethodLabels[before.revenueMethod];
      const now = revenueMethodLabels[line.revenueMethod];
      fields.push(t`revenue method ${was} → ${now}`);
    }
    const name = nameOf(before);
    const changed = fields.join(", ");
    changes.push(
      fields.length > 0 ? t`${name}: ${changed}` : t`${name} replaced`
    );
  }

  // A cancellation records every line end it moved; any other amendment ends
  // a line the day before it takes effect without writing a replacement.
  const previous = previousStateOf(amendment);
  if (previous) {
    for (const [lineId, wasEnd] of Object.entries(previous.lineEndDates)) {
      const line = lineById.get(lineId);
      if (!line?.endDate) continue;
      const name = nameOf(line);
      const end = formatDate(line.endDate);
      const was = wasEnd ? formatDate(wasEnd) : null;
      changes.push(
        was
          ? t`${name} ends ${end} (was ${was})`
          : t`${name} ends ${end} (was open-ended)`
      );
    }
  } else {
    const endedOn = dayBefore(amendment.amendmentDate);
    for (const line of lines) {
      if (
        line.endDate === endedOn &&
        line.amendmentId !== amendment.id &&
        !replacedIds.has(line.id)
      ) {
        const name = nameOf(line);
        changes.push(t`Ended ${name}`);
      }
    }
  }

  return (
    <div className="border-b border-input py-3 w-full min-w-0 last:border-b-0">
      <HStack className="justify-between items-start w-full">
        <VStack spacing={1} className="min-w-0 flex-1">
          <HStack spacing={2} className="flex-wrap text-sm">
            <span className="font-medium whitespace-nowrap">
              <DateTime value={amendment.amendmentDate} variant="date" />
            </span>
            <span className="text-muted-foreground">{effectLabel}</span>
          </HStack>
          <p className="text-sm">{amendment.reason}</p>
          {changes.length > 0 && (
            <ul className="text-sm text-muted-foreground list-disc pl-4">
              {changes.map((change, index) => (
                <li key={index}>{change}</li>
              ))}
            </ul>
          )}
        </VStack>
        <span className="text-xs text-muted-foreground shrink-0">
          {contractTypeLabel}
        </span>
      </HStack>
    </div>
  );
}

export default ContractAmendments;
