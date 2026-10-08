// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useCarbon } from "@carbon/auth";
import {
  Badge,
  HStack,
  Label,
  ModalCard,
  ModalCardBody,
  ModalCardContent,
  ModalCardDescription,
  ModalCardHeader,
  ModalCardProvider,
  ModalCardTitle,
  VStack
} from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { Trans } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import { useEffect, useState } from "react";
import { LuKeyRound } from "react-icons/lu";
import { useParams } from "react-router";
import { Hyperlink } from "~/components";
import {
  useCurrencyDecimals,
  useCurrencyFormatter,
  usePercentFormatter,
  useRouteData,
  useUser
} from "~/hooks";
import { path } from "~/utils/path";
import type { SalesInvoice, SalesInvoiceLine } from "../../types";
import { useRentalLineTypeLabel } from "./useRentalLineTypeLabel";

// A Rental line is written by rental invoice generation from its agreement's
// billing period or charge — it has no item, and it is never edited: this is
// what the line form shows instead.
export default function RentalInvoiceLineSummary({
  lineId,
  type,
  onClose
}: {
  lineId?: string;
  type?: "card" | "modal";
  onClose?: () => void;
}) {
  const { locale } = useLocale();
  const { carbon } = useCarbon();
  const { company } = useUser();
  const { invoiceId } = useParams();
  if (!invoiceId) throw new Error("invoiceId not found");

  const routeData = useRouteData<{
    salesInvoice: SalesInvoice;
    salesInvoiceLines: SalesInvoiceLine[];
    currency: { decimalPlaces: number } | null;
  }>(path.to.salesInvoice(invoiceId));
  const line = routeData?.salesInvoiceLines?.find((l) => l.id === lineId);

  const currency =
    routeData?.salesInvoice?.currencyCode ?? company.baseCurrencyCode;
  const configuredDecimals = useCurrencyDecimals(currency);
  const currencyFormatter = useCurrencyFormatter({
    currency,
    decimalPlaces: routeData?.currency?.decimalPlaces ?? configuredDecimals
  });
  const percentFormatter = usePercentFormatter();
  const lineTypeLabel = useRentalLineTypeLabel();

  const rentalAgreementId = line?.rentalAgreementId ?? null;
  const [agreementReadableId, setAgreementReadableId] = useState<string | null>(
    null
  );
  useEffect(() => {
    if (!carbon || !rentalAgreementId) return;
    let cancelled = false;
    carbon
      .from("rentalAgreement")
      .select("rentalAgreementId")
      .eq("id", rentalAgreementId)
      .eq("companyId", company.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setAgreementReadableId(data?.rentalAgreementId ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, [carbon, rentalAgreementId, company.id]);

  // The discount applies to the merchandise only, as the view's totals do.
  const amount =
    (line?.unitPrice ?? 0) *
    (line?.quantity ?? 1) *
    (1 - (line?.discountPercent ?? 0));
  const period =
    line?.serviceStartDate && line?.serviceEndDate
      ? `${formatDate(line.serviceStartDate, undefined, locale)} – ${formatDate(
          line.serviceEndDate,
          undefined,
          locale
        )}`
      : line?.serviceStartDate
        ? formatDate(line.serviceStartDate, undefined, locale)
        : "—";

  return (
    <ModalCardProvider type={type}>
      <ModalCard onClose={onClose}>
        <ModalCardContent size="xxlarge">
          <ModalCardHeader>
            <ModalCardTitle className="flex items-center gap-2">
              <LuKeyRound />
              {lineTypeLabel(line?.rentalLineType)}
            </ModalCardTitle>
            <ModalCardDescription>
              <Trans>
                Generated from a rental agreement. Change the agreement to
                change this line.
              </Trans>
            </ModalCardDescription>
          </ModalCardHeader>
          <ModalCardBody>
            <div className="grid w-full gap-x-8 gap-y-4 grid-cols-1 lg:grid-cols-3">
              <VStack spacing={1}>
                <Label className="text-muted-foreground">
                  <Trans>Rental Agreement</Trans>
                </Label>
                {rentalAgreementId ? (
                  <Hyperlink to={path.to.rentalAgreement(rentalAgreementId)}>
                    {agreementReadableId ?? rentalAgreementId}
                  </Hyperlink>
                ) : (
                  <span>—</span>
                )}
              </VStack>
              <VStack spacing={1}>
                <Label className="text-muted-foreground">
                  <Trans>Line Type</Trans>
                </Label>
                <span>{lineTypeLabel(line?.rentalLineType)}</span>
              </VStack>
              <VStack spacing={1}>
                <Label className="text-muted-foreground">
                  <Trans>Service Period</Trans>
                </Label>
                <span>{period}</span>
              </VStack>
              <VStack spacing={1} className="lg:col-span-2">
                <Label className="text-muted-foreground">
                  <Trans>Description</Trans>
                </Label>
                <span>{line?.description || "—"}</span>
              </VStack>
              <VStack spacing={1}>
                <Label className="text-muted-foreground">
                  <Trans>Amount</Trans>
                </Label>
                <HStack spacing={2}>
                  <span className="font-medium tabular-nums">
                    {currencyFormatter.format(amount)}
                  </span>
                  {(line?.taxPercent ?? 0) > 0 ? (
                    <Badge variant="red">
                      {percentFormatter.format(line?.taxPercent ?? 0)}{" "}
                      <Trans>Tax</Trans>
                    </Badge>
                  ) : null}
                </HStack>
              </VStack>
            </div>
          </ModalCardBody>
        </ModalCardContent>
      </ModalCard>
    </ModalCardProvider>
  );
}
