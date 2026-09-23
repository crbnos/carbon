import {
  Button,
  Card,
  CardAction,
  CardContent,
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
import { Link } from "react-router";
import { Hyperlink } from "~/components";
import { ConfirmDelete } from "~/components/Modals";
import { useDateFormatter, usePercentFormatter, usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import RentalMoney from "./RentalMoney";
import type {
  RentalAgreement,
  RentalAgreementCharge,
  RentalInvoiceLinks
} from "./types";

type RentalAgreementChargesProps = {
  rentalAgreement: RentalAgreement;
  charges: RentalAgreementCharge[];
  hasLines: boolean;
  invoiceLinks: RentalInvoiceLinks;
};

const RentalAgreementCharges = ({
  rentalAgreement,
  charges,
  hasLines,
  invoiceLinks
}: RentalAgreementChargesProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const { formatDate } = useDateFormatter();
  const percentFormatter = usePercentFormatter();
  const [deleting, setDeleting] = useState<RentalAgreementCharge | null>(null);

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
          {isOpen && (
            <CardAction>
              <Button
                variant="secondary"
                leftIcon={<LuPlus />}
                isDisabled={!hasLines || !permissions.can("create", "sales")}
                asChild
              >
                <Link to={path.to.newRentalAgreementCharge(id)}>
                  <Trans>Add Charge</Trans>
                </Link>
              </Button>
            </CardAction>
          )}
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
                      <Td>{formatDate(charge.chargeDate)}</Td>
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
      </Card>

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
