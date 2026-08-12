import { error, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import {
  cn,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  Status,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr
} from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import type { LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useNavigate } from "react-router";
import { Hyperlink } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { useCurrencyFormatter } from "~/hooks/useCurrencyFormatter";
import { getAccountingSyncTieOutCell } from "~/modules/accounting";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Sync Tie-Out`,
  to: path.to.accountingSyncTieOut
};

/**
 * Disposition colors — same semantics as the Sync Activity inbox
 * (~/modules/settings/ui/Integrations/SyncActivity.tsx STATUS_COLORS).
 */
const SYNC_STATUS_COLORS: Record<
  string,
  "yellow" | "blue" | "green" | "red" | "orange" | "gray"
> = {
  Pending: "yellow",
  "In Flight": "blue",
  Completed: "green",
  Failed: "red",
  Warning: "orange",
  Skipped: "gray",
  Excluded: "gray"
};

const INTEGRATION_LABELS: Record<string, string> = {
  xero: "Xero",
  quickbooks: "QuickBooks",
  rillet: "Rillet"
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "accounting",
    role: "employee"
  });

  const { cellId } = params;
  if (!cellId) throw notFound("cellId not found");

  const cellDetail = await getAccountingSyncTieOutCell(
    client,
    companyId,
    cellId
  );
  if (cellDetail.error || !cellDetail.data) {
    throw redirect(
      path.to.accountingSyncTieOut,
      await flash(
        request,
        error(cellDetail.error, "Failed to load the tie-out cell")
      )
    );
  }

  return cellDetail.data;
}

export default function SyncTieOutCellRoute() {
  const { cell, journals, truncated } = useLoaderData<typeof loader>();
  const { t } = useLingui();
  const { locale } = useLocale();
  const navigate = useNavigate();
  const currencyFormatter = useCurrencyFormatter();

  const period = cell.accountingPeriod;
  const periodLabel = period
    ? period.fiscalYear != null && period.periodNumber != null
      ? `${period.fiscalYear}-${String(period.periodNumber).padStart(2, "0")}`
      : `${formatDate(period.startDate, undefined, locale)} – ${formatDate(
          period.endDate,
          undefined,
          locale
        )}`
    : "—";
  const accountLabel = cell.account
    ? [cell.account.number, cell.account.name].filter(Boolean).join(" · ")
    : cell.accountId;
  const integrationLabel =
    INTEGRATION_LABELS[cell.integration] ?? cell.integration;

  const amounts: { label: string; value: number | null; delta?: boolean }[] = [
    { label: t`Carbon Posted`, value: cell.carbonPostedAmount },
    { label: t`Synced`, value: cell.syncedAmount },
    { label: t`Doc-Backed`, value: cell.docBackedAmount },
    { label: t`Excluded`, value: cell.excludedAmount },
    { label: t`Pending`, value: cell.pendingAmount },
    { label: t`Blocked`, value: cell.blockedAmount },
    { label: t`Provider`, value: cell.providerAmount },
    { label: t`Internal Delta`, value: cell.internalDelta, delta: true },
    { label: t`External Delta`, value: cell.externalDelta, delta: true }
  ];

  return (
    <Drawer
      open
      onOpenChange={(open) => {
        if (!open) navigate(path.to.accountingSyncTieOut);
      }}
    >
      <DrawerContent size="lg">
        <DrawerHeader>
          <DrawerTitle>{accountLabel}</DrawerTitle>
          <DrawerDescription>
            {periodLabel} · {integrationLabel}
          </DrawerDescription>
        </DrawerHeader>
        <DrawerBody className="gap-4">
          <div className="grid w-full grid-cols-2 gap-x-8 gap-y-2 rounded-lg border border-border p-4 sm:grid-cols-3">
            {amounts.map((amount) => {
              const nonzeroDelta =
                amount.delta &&
                amount.value != null &&
                Math.abs(amount.value) > 0.001;
              return (
                <div key={amount.label} className="flex flex-col">
                  <span className="text-xs text-muted-foreground">
                    {amount.label}
                  </span>
                  <span
                    className={cn(
                      "text-sm tabular-nums",
                      nonzeroDelta && "font-semibold text-destructive"
                    )}
                  >
                    {amount.value == null
                      ? "—"
                      : currencyFormatter.format(amount.value)}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="w-full rounded-lg border border-border">
            {journals.length === 0 ? (
              <div className="flex w-full items-center justify-center py-16 text-sm text-muted-foreground">
                <Trans>
                  No posted journals in this period for this account
                </Trans>
              </div>
            ) : (
              <Table>
                <Thead>
                  <Tr>
                    <Th className="px-4">
                      <Trans>Journal</Trans>
                    </Th>
                    <Th className="px-4">
                      <Trans>Date</Trans>
                    </Th>
                    <Th className="px-4 w-full">
                      <Trans>Source</Trans>
                    </Th>
                    <Th className="px-4 text-right">
                      <Trans>Amount</Trans>
                    </Th>
                    <Th className="px-4">
                      <Trans>Sync</Trans>
                    </Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {journals.map((journal) => (
                    <Tr key={journal.id}>
                      <Td className="px-4">
                        <Hyperlink to={path.to.journalEntryDetails(journal.id)}>
                          {journal.journalEntryId}
                        </Hyperlink>
                      </Td>
                      <Td className="px-4 whitespace-nowrap">
                        {formatDate(journal.postingDate, undefined, locale)}
                      </Td>
                      <Td className="px-4">
                        <Enumerable value={journal.sourceType} />
                      </Td>
                      <Td className="px-4 text-right text-sm tabular-nums">
                        {currencyFormatter.format(journal.accountAmount)}
                      </Td>
                      <Td className="px-4">
                        {journal.syncStatus ? (
                          <Status
                            color={
                              SYNC_STATUS_COLORS[journal.syncStatus] ?? "gray"
                            }
                          >
                            {journal.syncStatus}
                          </Status>
                        ) : (
                          <Status color="gray">
                            <Trans>Not recorded</Trans>
                          </Status>
                        )}
                      </Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            )}
          </div>
          {truncated && (
            <p className="text-xs text-muted-foreground">
              <Trans>Showing the newest 200 journals</Trans>
            </p>
          )}
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  );
}
