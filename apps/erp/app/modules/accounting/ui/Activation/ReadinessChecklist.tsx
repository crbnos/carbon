// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type {
  ActivationCheck,
  ActivationCheckItem
} from "@carbon/database/accounting-cutover-reads";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  Status,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr
} from "@carbon/react";
import { plural } from "@lingui/core/macro";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { type ComponentProps, useMemo } from "react";
import { Link } from "react-router";
import { ReceiptStatus } from "~/modules/inventory/ui/Receipts";
import { ShipmentStatus } from "~/modules/inventory/ui/Shipments";
import { MemoStatus } from "~/modules/invoicing/ui/Memo";
import { PaymentStatus } from "~/modules/invoicing/ui/Payment";
import { PurchaseInvoicingStatus } from "~/modules/invoicing/ui/PurchaseInvoice";
import SalesInvoiceStatus from "~/modules/invoicing/ui/SalesInvoice/SalesInvoiceStatus";
import { JobStatus } from "~/modules/production/ui/Jobs";
import { path } from "~/utils/path";
import { useAccountDefaultGroups } from "../AccountDefaults";
import { JournalEntryStatus } from "../JournalEntries";

/** Where a blocker lives, when it has a page of its own. */
function itemPath(item: ActivationCheckItem): string | null {
  switch (item.type) {
    case "accountDefault":
      return path.to.accountingDefaults;
    case "Receipt":
      return path.to.receipt(item.id);
    case "Shipment":
      return path.to.shipment(item.id);
    case "Sales Invoice":
      return path.to.salesInvoice(item.id);
    case "Purchase Invoice":
      return path.to.purchaseInvoice(item.id);
    case "Payment":
      return path.to.payment(item.id);
    case "Memo":
      return path.to.memo(item.id);
    case "Job":
      return path.to.job(item.id);
    case "Journal":
      return path.to.journalEntry(item.id);
    default:
      return null;
  }
}

function ItemTypeLabel({ type }: { type: string }) {
  switch (type) {
    case "Receipt":
      return <Trans>Receipt</Trans>;
    case "Shipment":
      return <Trans>Shipment</Trans>;
    case "Sales Invoice":
      return <Trans>Sales Invoice</Trans>;
    case "Purchase Invoice":
      return <Trans>Purchase Invoice</Trans>;
    case "Payment":
      return <Trans>Payment</Trans>;
    case "Memo":
      return <Trans>Memo</Trans>;
    case "Job":
      return <Trans>Job</Trans>;
    case "Journal":
      return <Trans>Journal Entry</Trans>;
    default:
      return <>{type}</>;
  }
}

/** An account default that is empty or names an inactive account. The other
 *  kind is a Migration Clearing account that is not an Equity posting
 *  account (status `migration-clearing-wrong-kind`). */
function isUnsetDefault(item: ActivationCheckItem) {
  return item.status === null || item.status === "Inactive";
}

/** A blocking document's or job's status, as its own pages show it. */
function ReadinessItemStatus({ item }: { item: ActivationCheckItem }) {
  switch (item.type) {
    case "Receipt":
      return (
        <ReceiptStatus
          status={item.status as ComponentProps<typeof ReceiptStatus>["status"]}
        />
      );
    case "Shipment":
      return (
        <ShipmentStatus
          status={
            item.status as ComponentProps<typeof ShipmentStatus>["status"]
          }
        />
      );
    case "Sales Invoice":
      return <SalesInvoiceStatus status={item.status} />;
    case "Purchase Invoice":
      return (
        <PurchaseInvoicingStatus
          status={
            item.status as ComponentProps<
              typeof PurchaseInvoicingStatus
            >["status"]
          }
        />
      );
    case "Payment":
      return (
        <PaymentStatus
          status={item.status as ComponentProps<typeof PaymentStatus>["status"]}
        />
      );
    case "Memo":
      return (
        <MemoStatus
          status={item.status as ComponentProps<typeof MemoStatus>["status"]}
        />
      );
    case "Job":
      return (
        <JobStatus
          status={item.status as ComponentProps<typeof JobStatus>["status"]}
        />
      );
    case "Journal":
      return (
        <JournalEntryStatus
          status={
            item.status as ComponentProps<typeof JournalEntryStatus>["status"]
          }
        />
      );
    default:
      return null;
  }
}

/** The readiness checks of the enable wizard, one row each. */
export default function ReadinessChecklist({
  checks
}: {
  checks: ActivationCheck[];
}) {
  const groups = useAccountDefaultGroups();
  const defaultLabels = useMemo(() => {
    const labels = new Map<string, string>();
    for (const group of groups) {
      for (const field of group.fields) labels.set(field.name, field.label);
    }
    return labels;
  }, [groups]);

  return (
    <ul className="divide-y divide-border rounded-lg border border-border">
      {checks.map((check) => (
        <ReadinessCheckRow
          key={check.key}
          check={check}
          defaultLabels={defaultLabels}
        />
      ))}
    </ul>
  );
}

function ReadinessCheckRow({
  check,
  defaultLabels
}: {
  check: ActivationCheck;
  /** Account default column → its label on the defaults page. */
  defaultLabels: Map<string, string>;
}) {
  const { t } = useLingui();

  const label = (() => {
    switch (check.key) {
      case "account-defaults":
        return t`Every account default is set`;
      case "fiscal-settings":
        return t`Fiscal year and base currency are set`;
      case "cutover-date":
        return t`The cutover date is valid`;
      case "pending-documents":
        return t`No unposted documents dated before the cutover`;
      case "legacy-jobs":
        return t`No open jobs from before Carbon recorded their costs`;
      case "opening-balance":
        return t`No posted opening balance`;
    }
  })();

  const detail = useCheckDetail(check);

  return (
    <li className="flex items-center justify-between gap-4 px-4 py-3">
      <div className="flex min-w-0 flex-col gap-1.5">
        <span className="text-sm font-medium">{label}</span>
        {detail && (
          <span className="text-sm text-muted-foreground">{detail}</span>
        )}
        {check.key === "account-defaults" && check.items.length > 0 && (
          <ul className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
            {check.items.map((item) => (
              <li key={item.id}>
                <Link
                  to={path.to.accountingDefaults}
                  className="text-primary underline underline-offset-4"
                >
                  {defaultLabels.get(item.id) ?? item.readableId}
                </Link>
                {item.status === "Inactive" && (
                  <span className="text-muted-foreground">
                    {" "}
                    <Trans>(inactive account)</Trans>
                  </span>
                )}
                {!isUnsetDefault(item) && (
                  <span className="text-muted-foreground">
                    {" "}
                    <Trans>(not an Equity posting account)</Trans>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        {check.key !== "account-defaults" && check.items.length > 0 && (
          <ReadinessItemsPopover check={check} label={label} />
        )}
      </div>
      <div className="shrink-0">
        {check.passed ? (
          <Status color="green">
            <Trans>Passed</Trans>
          </Status>
        ) : (
          <Status color="red">
            <Trans>Failing</Trans>
          </Status>
        )}
      </div>
    </li>
  );
}

/**
 * What to do about a failing check, in the user's language, from its key and
 * its items. The server's English `detail` is never shown. A function
 * declaration, so `plural()` folds into the `t` message.
 */
function useCheckDetail(check: ActivationCheck): string | null {
  const { t } = useLingui();
  if (check.passed) return null;
  switch (check.key) {
    case "account-defaults": {
      if (check.count === 0) {
        return t`The company has no account defaults.`;
      }
      const unset = check.items.some(isUnsetDefault);
      const wrongKind = check.reasons.includes("migration-clearing-wrong-kind");
      return [
        unset ? t`Set these account defaults to an active account.` : "",
        wrongKind
          ? t`Set the Migration Clearing account to an active Equity account that is not a group.`
          : ""
      ]
        .filter(Boolean)
        .join(" ");
    }
    case "fiscal-settings":
      return check.reasons
        .map((reason) => {
          switch (reason) {
            case "no-fiscal-year-settings":
              return t`Set the fiscal year settings.`;
            case "no-base-currency":
              return t`Set the base currency.`;
            default:
              return "";
          }
        })
        .filter(Boolean)
        .join(" ");
    case "cutover-date":
      switch (check.reasons[0]) {
        case "cutover-date-invalid":
          return t`The cutover date is not a valid date.`;
        case "cutover-date-not-period-start":
          return t`The cutover date must be the first day of a period.`;
        case "cutover-date-after-today":
          return t`The cutover date cannot be after today.`;
        case "cutover-date-too-far-back":
          return t`Choose the first day of the current period or of one of the 3 periods before it.`;
        default:
          return null;
      }
    case "pending-documents":
      return t`${plural(check.count, {
        one: "Post or delete the # document dated before the cutover.",
        other: "Post or delete the # documents dated before the cutover."
      })}`;
    case "legacy-jobs":
      return t`${plural(check.count, {
        one: "Complete or cancel the # job created before Carbon recorded its costs.",
        other:
          "Complete or cancel the # jobs created before Carbon recorded their costs."
      })}`;
    case "opening-balance":
      return t`The company already has a posted opening balance journal.`;
  }
}

/** The documents or jobs that block a check, each linked to its page. */
function ReadinessItemsPopover({
  check,
  label
}: {
  check: ActivationCheck;
  label: string;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="w-fit text-sm text-primary underline underline-offset-4"
        >
          <Plural
            value={check.count}
            one="# blocking record"
            other="# blocking records"
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-xl max-h-112 overflow-y-auto pointer-events-auto"
        onWheel={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col gap-2">
          <div className="text-sm font-medium">{label}</div>
          <Table className="w-full table-fixed">
            <Thead>
              <Tr>
                <Th className="w-[36%]">
                  <Trans>Record</Trans>
                </Th>
                <Th className="w-[34%]">
                  <Trans>Type</Trans>
                </Th>
                <Th className="w-[30%]">
                  <Trans>Status</Trans>
                </Th>
              </Tr>
            </Thead>
            <Tbody>
              {check.items.map((item) => {
                const to = itemPath(item);
                return (
                  <Tr key={`${item.type}-${item.id}`}>
                    <Td>
                      {to ? (
                        <Link to={to} className="text-primary hover:underline">
                          {item.readableId}
                        </Link>
                      ) : (
                        item.readableId
                      )}
                    </Td>
                    <Td>
                      <ItemTypeLabel type={item.type} />
                    </Td>
                    <Td>
                      <ReadinessItemStatus item={item} />
                    </Td>
                  </Tr>
                );
              })}
            </Tbody>
          </Table>
          {check.count > check.items.length && (
            <div className="text-xs text-muted-foreground">
              <Trans>
                And {check.count - check.items.length} more. Resolve these to
                see the rest.
              </Trans>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
