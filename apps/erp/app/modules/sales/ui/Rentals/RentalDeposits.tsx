import {
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr
} from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { LuPlus } from "react-icons/lu";
import { Link } from "react-router";
import { Hyperlink } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { useDateFormatter, usePermissions } from "~/hooks";
import { PaymentStatus } from "~/modules/invoicing/ui/Payment";
import { path } from "~/utils/path";
import RentalMoney from "./RentalMoney";
import type { RentalAgreement, RentalAgreementDeposit } from "./types";

type RentalDepositsProps = {
  rentalAgreement: RentalAgreement;
  deposits: RentalAgreementDeposit[];
};

/** Customer payments that reference the agreement: the refundable deposit
 *  held on the prepayment account, and any refund of it. */
const RentalDeposits = ({ rentalAgreement, deposits }: RentalDepositsProps) => {
  const permissions = usePermissions();
  const { formatDate } = useDateFormatter();

  const recordDepositUrl = (() => {
    const params = new URLSearchParams();
    if (rentalAgreement.customerId) {
      params.set("customerId", rentalAgreement.customerId);
    }
    params.set("rentalAgreementId", rentalAgreement.id!);
    if (Number(rentalAgreement.depositAmount) > 0) {
      params.set("amount", String(rentalAgreement.depositAmount));
    }
    return `${path.to.paymentNew}?${params.toString()}`;
  })();

  const canRecord =
    rentalAgreement.status === "Draft" || rentalAgreement.status === "Active";

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans>Deposits</Trans>
        </CardTitle>
        <CardDescription>
          <Trans>Agreed deposit:</Trans>{" "}
          <RentalMoney
            value={rentalAgreement.depositAmount}
            currencyCode={rentalAgreement.currencyCode}
          />
        </CardDescription>
        {canRecord && (
          <CardAction>
            <Button
              variant="secondary"
              leftIcon={<LuPlus />}
              isDisabled={!permissions.can("create", "invoicing")}
              asChild
            >
              <Link to={recordDepositUrl}>
                <Trans>Record Deposit</Trans>
              </Link>
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent>
        {deposits.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            <Trans>No deposit has been received for this agreement.</Trans>
          </p>
        ) : (
          <Table>
            <Thead>
              <Tr>
                <Th>
                  <Trans>Payment</Trans>
                </Th>
                <Th>
                  <Trans>Type</Trans>
                </Th>
                <Th>
                  <Trans>Date</Trans>
                </Th>
                <Th className="text-right">
                  <Trans>Amount</Trans>
                </Th>
                <Th>
                  <Trans>Status</Trans>
                </Th>
              </Tr>
            </Thead>
            <Tbody>
              {deposits.map((deposit) => (
                <Tr key={deposit.id}>
                  <Td>
                    <Hyperlink to={path.to.payment(deposit.id)}>
                      {deposit.paymentId}
                    </Hyperlink>
                  </Td>
                  <Td>
                    <Enumerable value={deposit.paymentType} />
                  </Td>
                  <Td>{formatDate(deposit.paymentDate) || "—"}</Td>
                  <Td className="text-right">
                    <RentalMoney
                      value={deposit.totalAmount}
                      currencyCode={deposit.currencyCode}
                    />
                  </Td>
                  <Td>
                    <PaymentStatus status={deposit.status} />
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
};

export default RentalDeposits;
