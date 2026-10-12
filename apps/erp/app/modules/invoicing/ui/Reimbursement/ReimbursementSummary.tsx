// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  cn,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr
} from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { Trans } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import { useMemo } from "react";
import { EmployeeAvatar } from "~/components";
// Imported by PATH, deliberately not re-exported from `~/components`. This
// component pulls the `@carbon/ee` barrel for the provider logo, and the
// components barrel is imported by nearly every route — putting it there drags
// the integrations registry into the chunk they all share.
import DocumentSourceBadge from "~/components/DocumentSourceBadge";
import { DimensionEntityTypeIcon } from "~/components/Icons";
import { useCurrencyFormatter } from "~/hooks";
import { getColor } from "~/modules/accounting/ui/JournalEntries/DimensionSelector";
import type { DimensionWithValues } from "~/modules/accounting/ui/JournalEntries/types";

type ReimbursementRow = Database["public"]["Tables"]["reimbursement"]["Row"];
type ReimbursementLineRow =
  Database["public"]["Tables"]["reimbursementLine"]["Row"] & {
    reimbursementLineDimension?:
      | Database["public"]["Tables"]["reimbursementLineDimension"]["Row"][]
      | null;
  };

type ResolvedDimension = {
  dimensionId: string;
  dimensionName: string;
  entityType: string;
  valueId: string;
  valueName: string;
};

type ReimbursementSummaryProps = {
  reimbursement: ReimbursementRow;
  lines: ReimbursementLineRow[];
  accountsById: Record<
    string,
    { id: string; number: string | null; name: string }
  >;
  mapping: {
    externalId: string | null;
    metadata: { deepLink?: string } | null;
  } | null;
  availableDimensions: DimensionWithValues[];
};

/**
 * Resolves a line's dimensions to display names, unioning the generic
 * `reimbursementLineDimension` pairs with the two legacy columns the Ramp sync
 * writes — de-duplicated by `dimensionId`, exactly as the posting pass does.
 * Every id is resolved to a NAME; rendering a raw id at the user is a defect.
 */
function resolveLineDimensions(
  line: ReimbursementLineRow,
  availableDimensions: DimensionWithValues[]
): ResolvedDimension[] {
  const byDimensionId = new Map<string, ResolvedDimension>();

  const push = (dimensionId: string, valueId: string) => {
    if (byDimensionId.has(dimensionId)) return;
    const dimension = availableDimensions.find(
      (d) => d.dimensionId === dimensionId
    );
    if (!dimension) return;
    const value = dimension.values.find((v) => v.id === valueId);
    byDimensionId.set(dimensionId, {
      dimensionId,
      dimensionName: dimension.dimensionName,
      entityType: dimension.entityType,
      valueId,
      valueName: value?.name ?? valueId
    });
  };

  for (const pair of line.reimbursementLineDimension ?? []) {
    push(pair.dimensionId, pair.valueId);
  }

  // The legacy columns resolve through the same configured dimension list.
  for (const [entityType, valueId] of [
    ["CostCenter", line.costCenterId],
    ["Project", line.projectId]
  ] as const) {
    if (!valueId) continue;
    const dimension = availableDimensions.find(
      (d) => d.entityType === entityType
    );
    if (dimension) push(dimension.dimensionId, valueId);
  }

  return [...byDimensionId.values()];
}

/**
 * Read mode of a reimbursement, laid flat under the page header: its facts,
 * then its coding lines. The id and status live in the header, and the
 * employee's page, the journal entry and the payments under Documents.
 */
const ReimbursementSummary = ({
  reimbursement,
  lines,
  accountsById,
  mapping,
  availableDimensions
}: ReimbursementSummaryProps) => {
  const { locale } = useLocale();
  const currencyFormatter = useCurrencyFormatter({
    currency: reimbursement.currencyCode
  });

  const dimensionsByLineId = useMemo(
    () =>
      new Map(
        lines.map((line) => [
          line.id,
          resolveLineDimensions(line, availableDimensions)
        ])
      ),
    [lines, availableDimensions]
  );

  const accountLabel = (accountId: string | null) => {
    if (!accountId) return null;
    const account = accountsById[accountId];
    return account
      ? [account.number, account.name].filter(Boolean).join(" ")
      : accountId;
  };

  return (
    <>
      <div className="flex flex-col gap-4 w-full pt-2 pb-4">
        <DocumentSourceBadge
          integration={reimbursement.integration}
          externalId={mapping?.externalId}
          deepLink={mapping?.metadata?.deepLink}
        />
        <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm w-full">
          <dt className="text-muted-foreground">
            <Trans>Employee</Trans>
          </dt>
          <dd className="min-w-0">
            <EmployeeAvatar employeeId={reimbursement.employeeId} />
          </dd>

          <dt className="text-muted-foreground">
            <Trans>Reimbursement Date</Trans>
          </dt>
          <dd>
            {formatDate(reimbursement.reimbursementDate, undefined, locale)}
          </dd>

          <dt className="text-muted-foreground">
            <Trans>Amount</Trans>
          </dt>
          <dd className="tabular-nums">
            {currencyFormatter.format(Number(reimbursement.amount))}
          </dd>

          <dt className="text-muted-foreground">
            <Trans>Currency</Trans>
          </dt>
          <dd>{reimbursement.currencyCode}</dd>

          <dt className="text-muted-foreground">
            <Trans>Reference</Trans>
          </dt>
          <dd className="min-w-0 break-words">
            {reimbursement.reference ?? "—"}
          </dd>

          {reimbursement.postingDate && (
            <>
              <dt className="text-muted-foreground">
                <Trans>Posting Date</Trans>
              </dt>
              <dd>
                {formatDate(reimbursement.postingDate, undefined, locale)}
              </dd>
            </>
          )}

          {reimbursement.notes && (
            <>
              <dt className="text-muted-foreground">
                <Trans>Notes</Trans>
              </dt>
              <dd className="min-w-0 whitespace-pre-wrap break-words">
                {reimbursement.notes}
              </dd>
            </>
          )}
        </dl>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            <Trans>Line items</Trans>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <Thead>
              <Tr>
                <Th>
                  <Trans>Account</Trans>
                </Th>
                <Th>
                  <Trans>Dimensions</Trans>
                </Th>
                <Th>
                  <Trans>Description</Trans>
                </Th>
                <Th className="text-right">
                  <Trans>Amount</Trans>
                </Th>
              </Tr>
            </Thead>
            <Tbody>
              {lines.length === 0 ? (
                <Tr>
                  <Td colSpan={4} className="text-center text-muted-foreground">
                    <Trans>No lines</Trans>
                  </Td>
                </Tr>
              ) : (
                lines.map((line) => {
                  const dimensions = dimensionsByLineId.get(line.id) ?? [];
                  return (
                    <Tr key={line.id}>
                      <Td>{accountLabel(line.accountId)}</Td>
                      <Td>
                        {dimensions.length === 0 ? (
                          "—"
                        ) : (
                          <div className="flex flex-wrap items-center gap-1.5">
                            {dimensions.map((dimension) => (
                              <Badge
                                key={dimension.dimensionId}
                                variant="outline"
                                className={cn(
                                  "inline-flex items-center gap-1",
                                  getColor(dimension.entityType)
                                )}
                              >
                                <DimensionEntityTypeIcon
                                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                  entityType={dimension.entityType as any}
                                  className="size-3"
                                />
                                <span>{dimension.valueName}</span>
                              </Badge>
                            ))}
                          </div>
                        )}
                      </Td>
                      <Td>{line.description ?? "—"}</Td>
                      <Td className="text-right tabular-nums">
                        {currencyFormatter.format(Number(line.amount))}
                      </Td>
                    </Tr>
                  );
                })
              )}
            </Tbody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
};

export default ReimbursementSummary;
