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

/** Setup step 3: who is billed, how often, and the invoices that follow. */
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

  return (
    <SetupBody>
      <ContractBillTo
        contract={contract}
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
