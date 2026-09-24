import type { Database } from "@carbon/database";
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  cn,
  HStack,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  VStack
} from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { Trans } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import { useMemo } from "react";
import { DocumentSourceBadge, EmployeeAvatar, Hyperlink } from "~/components";
import { useAuditLog } from "~/components/AuditLog";
import { DimensionEntityTypeIcon } from "~/components/Icons";
import { useCurrencyFormatter, useUser } from "~/hooks";
import { getColor } from "~/modules/accounting/ui/JournalEntries/DimensionSelector";
import type { DimensionWithValues } from "~/modules/accounting/ui/JournalEntries/types";
import { path } from "~/utils/path";
import ReimbursementStatus from "./ReimbursementStatus";

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
  journal: { id: string; journalEntryId: string } | null;
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

const ReimbursementSummary = ({
  reimbursement,
  lines,
  accountsById,
  journal,
  mapping,
  availableDimensions
}: ReimbursementSummaryProps) => {
  const { locale } = useLocale();
  const { company } = useUser();
  const currencyFormatter = useCurrencyFormatter({
    currency: reimbursement.currencyCode
  });

  const { trigger: auditLogTrigger, drawer: auditLogDrawer } = useAuditLog({
    entityType: "reimbursement",
    entityId: reimbursement.id,
    companyId: company.id,
    variant: "card-action"
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
      <Card>
        <CardHeader className="flex-row items-start justify-between gap-4">
          <VStack spacing={2}>
            <CardTitle>{reimbursement.reimbursementId}</CardTitle>
            <HStack spacing={2}>
              <ReimbursementStatus status={reimbursement.status} />
              <EmployeeAvatar employeeId={reimbursement.employeeId} />
            </HStack>
          </VStack>
          <HStack spacing={4} className="items-start">
            <DocumentSourceBadge
              integration={reimbursement.integration}
              externalId={mapping?.externalId}
              deepLink={mapping?.metadata?.deepLink}
            />
            {auditLogTrigger}
          </HStack>
        </CardHeader>
        <CardContent>
          <VStack spacing={4}>
            <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm w-full">
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
              <dd>{reimbursement.reference ?? "—"}</dd>

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

              {reimbursement.journalId && (
                <>
                  <dt className="text-muted-foreground">
                    <Trans>Journal</Trans>
                  </dt>
                  <dd>
                    {journal ? (
                      <Hyperlink to={path.to.journalEntryDetails(journal.id)}>
                        {journal.journalEntryId}
                      </Hyperlink>
                    ) : (
                      reimbursement.journalId
                    )}
                  </dd>
                </>
              )}

              {reimbursement.notes && (
                <>
                  <dt className="text-muted-foreground">
                    <Trans>Notes</Trans>
                  </dt>
                  <dd className="whitespace-pre-wrap">{reimbursement.notes}</dd>
                </>
              )}
            </dl>

            <div className="w-full">
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
                      <Td
                        colSpan={4}
                        className="text-center text-muted-foreground"
                      >
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
            </div>
          </VStack>
        </CardContent>
      </Card>
      {auditLogDrawer}
    </>
  );
};

export default ReimbursementSummary;
