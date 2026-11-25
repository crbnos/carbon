// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  HStack,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { LuFileText } from "react-icons/lu";
import { DateTime } from "~/components";
import { usePermissions } from "~/hooks";
import type { RentalNextInvoice as RentalNextInvoiceData } from "~/modules/sales/sales.service";
import { path } from "~/utils/path";
import { useInvoiceAutomationHint } from "../useInvoiceAutomationHint";
import RentalInvoiceLinesTable from "./RentalInvoiceLinesTable";
import type { RentalAgreement } from "./types";

type RentalNextInvoiceProps = {
  rentalAgreement: RentalAgreement;
  nextInvoice: RentalNextInvoiceData | null;
};

/** What the next billing run will draft, before it exists: each invoice's
 *  lines, tax and total, and the same invoice as a PDF. Nothing is saved.
 *  Amounts are base currency, which is a rental agreement's only currency. */
const RentalNextInvoice = ({
  rentalAgreement,
  nextInvoice
}: RentalNextInvoiceProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const canPreviewPdf = permissions.has({ "invoicing.salesInvoices": "View" });
  const currencyCode = rentalAgreement.currencyCode;
  const automationHint = useInvoiceAutomationHint();
  // The daily run drafts nothing for a Manual agreement, so it has no next
  // invoice to show.
  const isManual = rentalAgreement.effectiveInvoiceAutomation === "Manual";

  const invoiceTitle = (role: "combined" | "rent" | "charges") => {
    switch (role) {
      case "rent":
        return t`Rent invoice`;
      case "charges":
        return t`Charges invoice`;
      default:
        return t`Invoice`;
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans>Next Invoice</Trans>
        </CardTitle>
        {isManual ? (
          <CardDescription>{automationHint("Manual")}</CardDescription>
        ) : (
          nextInvoice && (
            <CardDescription>
              <Trans>
                Drafted on <DateTime value={nextInvoice.asOf} variant="date" />.
                Nothing is saved until then.
              </Trans>
            </CardDescription>
          )
        )}
      </CardHeader>
      {!isManual && (
        <CardContent>
          {!nextInvoice ? (
            <p className="text-sm text-muted-foreground">
              <Trans>No upcoming invoice.</Trans>
            </p>
          ) : (
            <VStack spacing={8}>
              {nextInvoice.invoices.map((invoice) => (
                <VStack key={invoice.role} spacing={2}>
                  <HStack className="w-full justify-between">
                    <HStack>
                      <span className="text-sm font-medium">
                        {invoiceTitle(invoice.role)}
                      </span>
                      {invoice.holdReason && (
                        <Badge variant="orange">{invoice.holdReason}</Badge>
                      )}
                    </HStack>
                    {canPreviewPdf && (
                      <Button
                        variant="secondary"
                        size="sm"
                        leftIcon={<LuFileText />}
                        asChild
                      >
                        <a
                          href={path.to.file.rentalNextInvoice(
                            rentalAgreement.id!,
                            invoice.role === "charges" ? "charges" : undefined
                          )}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <Trans>Preview PDF</Trans>
                        </a>
                      </Button>
                    )}
                  </HStack>
                  <RentalInvoiceLinesTable
                    lines={invoice.lines}
                    subtotal={invoice.subtotal}
                    totalTax={invoice.totalTax}
                    totalAmount={invoice.totalAmount}
                    currencyCode={currencyCode}
                  />
                </VStack>
              ))}
            </VStack>
          )}
        </CardContent>
      )}
    </Card>
  );
};

export default RentalNextInvoice;
