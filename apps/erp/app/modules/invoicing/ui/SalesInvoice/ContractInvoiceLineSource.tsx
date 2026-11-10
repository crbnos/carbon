// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useCarbon } from "@carbon/auth";
import { Trans } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { Hyperlink } from "~/components";
import { useRouteData, useUser } from "~/hooks";
import { path } from "~/utils/path";
import type { SalesInvoiceLine } from "../../types";

// A line drafted from a contract's invoice schedule carries the contract and
// line it came from; the contract is where its price and period are changed.
export default function ContractInvoiceLineSource({
  lineId
}: {
  lineId?: string;
}) {
  const { carbon } = useCarbon();
  const { company } = useUser();
  const { invoiceId } = useParams();
  if (!invoiceId) throw new Error("invoiceId not found");

  const routeData = useRouteData<{
    salesInvoiceLines: SalesInvoiceLine[];
  }>(path.to.salesInvoice(invoiceId));
  const line = routeData?.salesInvoiceLines?.find((l) => l.id === lineId);
  const customerContractId = line?.customerContractLineId
    ? line.customerContractId
    : null;

  const [contractReadableId, setContractReadableId] = useState<string | null>(
    null
  );
  useEffect(() => {
    if (!carbon || !customerContractId) return;
    let cancelled = false;
    carbon
      .from("customerContract")
      .select("customerContractId")
      .eq("id", customerContractId)
      .eq("companyId", company.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setContractReadableId(data?.customerContractId ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, [carbon, customerContractId, company.id]);

  if (!customerContractId) return null;
  const readableId = contractReadableId ?? customerContractId;

  return (
    <span className="flex items-center gap-1">
      <Trans>
        Generated from contract{" "}
        <Hyperlink to={path.to.contract(customerContractId)}>
          {readableId}
        </Hyperlink>
      </Trans>
    </span>
  );
}
