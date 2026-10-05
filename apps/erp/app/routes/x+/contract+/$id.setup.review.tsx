// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { equals } from "@carbon/utils";
import { Trans } from "@lingui/react/macro";
import { LuCircleCheck, LuTriangleAlert } from "react-icons/lu";
import { Link, useParams } from "react-router";
import { useRouteData } from "~/hooks";
import type { ContractRouteData } from "~/modules/sales/ui/Contracts";
import {
  ContractMoney,
  ContractSetupBody,
  ContractSetupSection,
  ContractSummary,
  contractLineName
} from "~/modules/sales/ui/Contracts";
import { path } from "~/utils/path";

/** Setup step 5: the contract at a glance, and anything that would stop
 *  Confirm. Confirm and Save as Draft are in the footer. */
export default function ContractSetupReviewRoute() {
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");

  const routeData = useRouteData<ContractRouteData>(path.to.contract(id));
  if (!routeData) return null;
  const {
    contract,
    lines,
    schedule,
    computedSchedule,
    residuals,
    revenueResiduals
  } = routeData;

  const currencyCode = contract.currencyCode ?? "USD";
  const nameOf = (lineId: string) => {
    const line = lines.find((l) => l.id === lineId);
    return line ? contractLineName(line) : lineId;
  };
  const invoiceGaps = Object.entries(residuals).filter(
    ([, residual]) => !equals(residual, 0)
  );
  const revenueGaps = Object.entries(revenueResiduals).filter(
    ([, residual]) => !equals(residual, 0)
  );
  const isReady =
    lines.length > 0 && invoiceGaps.length === 0 && revenueGaps.length === 0;

  return (
    <ContractSetupBody>
      <ContractSetupSection
        title={<Trans>Review</Trans>}
        description={
          <Trans>
            Confirming fixes the invoice schedule and starts invoicing. After
            that the terms and lines change with Amend.
          </Trans>
        }
      >
        <div className="w-full max-w-3xl">
          <ContractSummary
            contract={contract}
            lines={lines}
            schedule={schedule}
            computedSchedule={computedSchedule}
          />
        </div>
      </ContractSetupSection>

      <ContractSetupSection title={<Trans>Before You Confirm</Trans>}>
        {isReady ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <LuCircleCheck className="size-4 shrink-0" />
            <Trans>
              Every line is fully invoiced and recognizes what it bills.
            </Trans>
          </p>
        ) : (
          <ul className="flex w-full max-w-3xl flex-col gap-3 text-sm">
            {lines.length === 0 && (
              <Gap to={path.to.contractSetup(id, "products")}>
                <Trans>Add at least one service.</Trans>
              </Gap>
            )}
            {invoiceGaps.map(([lineId, residual]) => (
              <Gap
                key={`invoice-${lineId}`}
                to={path.to.contractSetup(id, "invoicing")}
              >
                <Trans>
                  {nameOf(lineId)} has{" "}
                  <ContractMoney value={residual} currencyCode={currencyCode} />{" "}
                  left to invoice.
                </Trans>
              </Gap>
            ))}
            {revenueGaps.map(([lineId, residual]) => (
              <Gap
                key={`revenue-${lineId}`}
                to={path.to.contractSetup(id, "revenue")}
              >
                <Trans>
                  {nameOf(lineId)} has{" "}
                  <ContractMoney value={residual} currencyCode={currencyCode} />{" "}
                  left to recognize.
                </Trans>
              </Gap>
            ))}
          </ul>
        )}
      </ContractSetupSection>
    </ContractSetupBody>
  );
}

/** One thing stopping Confirm, linked to the step that fixes it. */
function Gap({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <LuTriangleAlert className="mt-0.5 size-4 shrink-0 text-red-500" />
      <Link to={to} className="hover:underline">
        {children}
      </Link>
    </li>
  );
}
