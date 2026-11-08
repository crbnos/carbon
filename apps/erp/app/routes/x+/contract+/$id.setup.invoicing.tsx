// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Trans } from "@lingui/react/macro";
import { useParams } from "react-router";
import { SetupBody, SetupSection } from "~/components/Setup";
import { useRouteData } from "~/hooks";
import type { ContractRouteData } from "~/modules/sales/ui/Contracts";
import {
  ContractBillTo,
  ContractInvoiceGrid
} from "~/modules/sales/ui/Contracts";
import { path } from "~/utils/path";

/** Setup step 3: who is billed, how often, and the invoices that follow. A
 *  project contract's Time & Materials and Cost Plus lines bill from project
 *  cost; only its Fixed Price lines have invoices planned here, its billing
 *  events. */
export default function ContractSetupInvoicingRoute() {
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");

  const routeData = useRouteData<ContractRouteData>(path.to.contract(id));
  if (!routeData) return null;
  const { contract, lines, schedule, computedSchedule, residuals } = routeData;

  const plannedFirstInvoice = computedSchedule
    ? (computedSchedule.find((invoice) => invoice.status === "Planned")
        ?.invoiceDate ?? null)
    : (schedule.find((invoice) => invoice.status === "Planned")?.invoiceDate ??
      null);

  if (contract.billingBasis === "Project") {
    // A billing line has no schedule rows, so the schedule holds the Fixed
    // Price lines' billing events only.
    const fixedLines = lines.filter((line) => line.billingMethod === "Fixed");
    return (
      <SetupBody>
        <ContractBillTo
          contract={contract}
          billingBasis="Project"
          plannedFirstInvoice={plannedFirstInvoice}
        />
        {fixedLines.length > 0 ? (
          <SetupSection
            title={<Trans>Billing Events</Trans>}
            description={
              <Trans>
                Each row is an invoice for a Fixed Price line. Add, split or
                move rows until each line's rows add up to its price.
              </Trans>
            }
          >
            <ContractInvoiceGrid
              contract={contract}
              lines={fixedLines}
              schedule={schedule}
              computedSchedule={computedSchedule}
              residuals={residuals}
            />
          </SetupSection>
        ) : (
          <p className="w-full border-t border-border pt-12 text-sm text-muted-foreground">
            <Trans>
              Time & Materials and Cost Plus lines bill from project cost every
              billing period.
            </Trans>
          </p>
        )}
      </SetupBody>
    );
  }

  return (
    <SetupBody>
      <ContractBillTo
        contract={contract}
        billingBasis={contract.billingBasis}
        plannedFirstInvoice={plannedFirstInvoice}
      />
      <SetupSection
        title={<Trans>Invoices</Trans>}
        description={
          <Trans>
            One row per invoice, one column per line. Change a date or an
            amount, add an invoice or delete one.
          </Trans>
        }
      >
        <ContractInvoiceGrid
          contract={contract}
          lines={lines}
          schedule={schedule}
          computedSchedule={computedSchedule}
          residuals={residuals}
        />
      </SetupSection>
    </SetupBody>
  );
}
