// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Button,
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  IconButton,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { LuPlus, LuTrash } from "react-icons/lu";
import { DateTime, Hyperlink } from "~/components";
import { ConfirmDelete } from "~/components/Modals";
import { useCompanyToday, usePercentFormatter, usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import RentalAgreementChargeForm from "./RentalAgreementChargeForm";
import RentalMoney from "./RentalMoney";
import type {
  RentalAgreement,
  RentalAgreementCharge,
  RentalAgreementLine,
  RentalInvoiceLinks
} from "./types";
import { rentalUnitLabel } from "./useRentalLineActions";

type RentalAgreementChargesProps = {
  rentalAgreement: RentalAgreement;
  charges: RentalAgreementCharge[];
  lines: RentalAgreementLine[];
  invoiceLinks: RentalInvoiceLinks;
  /** On a unit's page: only that unit's charges, and new ones are for it. */
  lineId?: string;
};

const RentalAgreementCharges = ({
  rentalAgreement,
  charges: allCharges,
  lines,
  invoiceLinks,
  lineId
}: RentalAgreementChargesProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const percentFormatter = usePercentFormatter();
  const companyToday = useCompanyToday();
  const [deleting, setDeleting] = useState<RentalAgreementCharge | null>(null);
  const [adding, setAdding] = useState(false);

  const charges = lineId
    ? allCharges.filter((charge) => charge.rentalAgreementLineId === lineId)
    : allCharges;
  const hasLines = lines.length > 0;
  const lineOptions = lines.map((line) => ({
    value: line.id,
    label: rentalUnitLabel(line) || line.id
  }));

  const id = rentalAgreement.id!;
  const isOpen =
    rentalAgreement.status === "Draft" || rentalAgreement.status === "Active";

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>
            <Trans>Charges</Trans>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {charges.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              <Trans>
                No charges. Mileage, damage, delivery or cleaning charges ride
                the next invoice.
              </Trans>
            </p>
          ) : (
            <Table>
              <Thead>
                <Tr>
                  <Th>
                    <Trans>Date</Trans>
                  </Th>
                  <Th>
                    <Trans>Unit</Trans>
                  </Th>
                  <Th>
                    <Trans>Description</Trans>
                  </Th>
                  <Th className="text-right">
                    <Trans>Amount</Trans>
                  </Th>
                  <Th className="text-right">
                    <Trans>Tax</Trans>
                  </Th>
                  <Th>
                    <Trans>Invoice</Trans>
                  </Th>
                  <Th />
                </Tr>
              </Thead>
              <Tbody>
                {charges.map((charge) => {
                  const invoice = charge.salesInvoiceLineId
                    ? invoiceLinks[charge.salesInvoiceLineId]
                    : undefined;
                  return (
                    <Tr key={charge.id}>
                      <Td>
                        <DateTime value={charge.chargeDate} variant="date" />
                      </Td>
                      <Td>
                        {charge.rentalAgreementLine?.fixedAsset?.fixedAssetId ??
                          "—"}
                      </Td>
                      <Td>{charge.description}</Td>
                      <Td className="text-right">
                        <RentalMoney
                          value={charge.amount}
                          currencyCode={rentalAgreement.currencyCode}
                        />
                      </Td>
                      <Td className="text-right tabular-nums">
                        {percentFormatter.format(Number(charge.taxPercent))}
                      </Td>
                      <Td>
                        {invoice ? (
                          <Hyperlink
                            to={path.to.salesInvoiceDetails(invoice.id)}
                          >
                            {invoice.invoiceId ?? t`Invoice`}
                          </Hyperlink>
                        ) : charge.salesInvoiceLineId ? (
                          <Trans>Invoiced</Trans>
                        ) : (
                          <span className="text-muted-foreground">
                            <Trans>Unbilled</Trans>
                          </span>
                        )}
                      </Td>
                      <Td className="text-right">
                        {isOpen && !charge.salesInvoiceLineId && (
                          <IconButton
                            aria-label={t`Delete charge`}
                            icon={<LuTrash />}
                            variant="ghost"
                            size="sm"
                            isDisabled={!permissions.can("delete", "sales")}
                            onClick={() => setDeleting(charge)}
                          />
                        )}
                      </Td>
                    </Tr>
                  );
                })}
              </Tbody>
            </Table>
          )}
        </CardContent>
        {isOpen && (
          <CardFooter>
            <Button
              variant="secondary"
              leftIcon={<LuPlus />}
              isDisabled={!hasLines || !permissions.can("create", "sales")}
              onClick={() => setAdding(true)}
            >
              <Trans>Add Charge</Trans>
            </Button>
          </CardFooter>
        )}
      </Card>

      {adding && (
        <RentalAgreementChargeForm
          action={path.to.newRentalAgreementCharge(id)}
          initialValues={{
            rentalAgreementLineId:
              lineId ?? (lines.length === 1 ? lines[0].id : ""),
            chargeDate: companyToday,
            description: "",
            amount: 0,
            taxPercent: rentalAgreement.taxPercent ?? 0
          }}
          currencyCode={rentalAgreement.currencyCode ?? ""}
          lineOptions={lineOptions}
          onClose={() => setAdding(false)}
        />
      )}

      {deleting && (
        <ConfirmDelete
          action={path.to.deleteRentalAgreementCharge(id, deleting.id)}
          isOpen
          name={deleting.description}
          text={t`Are you sure you want to delete the charge "${deleting.description}"?`}
          onCancel={() => setDeleting(null)}
          onSubmit={() => setDeleting(null)}
        />
      )}
    </>
  );
};

export default RentalAgreementCharges;
