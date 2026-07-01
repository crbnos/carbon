import {
  Button,
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  HStack,
  Status,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useMemo } from "react";
import {
  LuArrowUpRight,
  LuBanknote,
  LuClock,
  LuHandCoins
} from "react-icons/lu";
import { Link } from "react-router";
import { useCurrencyFormatter, useDateFormatter } from "~/hooks";
import { useCustomers, useSuppliers } from "~/stores";
import { path } from "~/utils/path";
import PaymentStatus from "../Payment/PaymentStatus";

export type AgingTotals = {
  current: number;
  bucket1: number;
  bucket2: number;
  bucket3: number;
  bucket4: number;
  unapplied: number;
  total: number;
  count: number;
};

export type TieOut = {
  subledgerBalance: number;
  glBalance: number;
  variance: number;
} | null;

export type RecentPayment = {
  id: string;
  paymentId: string;
  paymentType: "Receipt" | "Disbursement";
  status: "Draft" | "Posted" | "Voided" | null;
  paymentDate: string | null;
  totalAmount: number;
  currencyCode: string;
  customerId: string | null;
  supplierId: string | null;
};

type InvoicingDashboardProps = {
  asOfDate: string;
  ar: AgingTotals;
  ap: AgingTotals;
  arTieOut: TieOut;
  apTieOut: TieOut;
  bucketDays: [number, number, number];
  recentPayments: RecentPayment[];
};

// Variance below this (in base currency) is treated as tied-out — guards against
// floating-point dust in the subledger-vs-GL comparison. Matches TieOut.tsx.
const TIE_OUT_EPSILON = 0.01;

const overdueOf = (t: AgingTotals) =>
  t.bucket1 + t.bucket2 + t.bucket3 + t.bucket4;

const AgingCard = ({
  title,
  icon,
  totals,
  tieOut,
  bucketLabels,
  format
}: {
  title: React.ReactNode;
  icon: React.ReactNode;
  totals: AgingTotals;
  tieOut: TieOut;
  bucketLabels: string[];
  format: (n: number) => string;
}) => {
  const buckets = [
    { label: <Trans>Current</Trans>, value: totals.current },
    { label: bucketLabels[0], value: totals.bucket1 },
    { label: bucketLabels[1], value: totals.bucket2 },
    { label: bucketLabels[2], value: totals.bucket3 },
    { label: bucketLabels[3], value: totals.bucket4 }
  ];
  const tied = tieOut ? Math.abs(tieOut.variance) < TIE_OUT_EPSILON : true;

  return (
    <Card>
      <CardHeader className="flex-row gap-2">
        <span className="text-muted-foreground">{icon}</span>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <Thead>
            <Tr>
              <Th>
                <Trans>Bucket</Trans>
              </Th>
              <Th className="text-right">
                <Trans>Amount</Trans>
              </Th>
            </Tr>
          </Thead>
          <Tbody>
            {buckets.map((b, i) => (
              <Tr key={i}>
                <Td>{b.label}</Td>
                <Td className="text-right tabular-nums">{format(b.value)}</Td>
              </Tr>
            ))}
            {totals.unapplied !== 0 ? (
              <Tr className="text-muted-foreground">
                <Td>
                  <Trans>Unapplied</Trans>
                </Td>
                <Td className="text-right tabular-nums">
                  {format(totals.unapplied)}
                </Td>
              </Tr>
            ) : null}
            <Tr className="font-medium">
              <Td>
                <Trans>Total</Trans>
              </Td>
              <Td className="text-right tabular-nums">
                {format(totals.total)}
              </Td>
            </Tr>
          </Tbody>
        </Table>
      </CardContent>
      <CardFooter className="justify-between text-xs">
        <span className="text-muted-foreground">
          <Trans>GL tie-out</Trans>
        </span>
        {tieOut ? (
          tied ? (
            <Status color="green">
              <Trans>Balanced</Trans>
            </Status>
          ) : (
            <Status color="red">
              <span className="tabular-nums">{format(tieOut.variance)}</span>
            </Status>
          )
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </CardFooter>
    </Card>
  );
};

const InvoicingDashboard = ({
  ar,
  ap,
  arTieOut,
  apTieOut,
  bucketDays,
  recentPayments
}: InvoicingDashboardProps) => {
  const { t } = useLingui();
  const { formatDate } = useDateFormatter();
  const currencyFormatter = useCurrencyFormatter();
  const format = (n: number) => currencyFormatter.format(n);
  const [customers] = useCustomers();
  const [suppliers] = useSuppliers();

  const customerName = useMemo(
    () => new Map(customers.map((c) => [c.id, c.name])),
    [customers]
  );
  const supplierName = useMemo(
    () => new Map(suppliers.map((s) => [s.id, s.name])),
    [suppliers]
  );

  const [b1, b2, b3] = bucketDays;
  const bucketLabels = [
    `1–${b1}`,
    `${b1 + 1}–${b2}`,
    `${b2 + 1}–${b3}`,
    `${b3}+`
  ];

  const arOverdue = overdueOf(ar);
  const apOverdue = overdueOf(ap);
  const arOverduePct =
    ar.total > 0 ? Math.round((arOverdue / ar.total) * 100) : 0;
  const apOverduePct =
    ap.total > 0 ? Math.round((apOverdue / ap.total) * 100) : 0;

  return (
    <div className="flex flex-col gap-4 w-full p-4 h-[calc(100dvh-var(--header-height))] overflow-y-auto scrollbar-thin scrollbar-thumb-rounded-full scrollbar-thumb-muted-foreground">
      {/* KPI Cards */}
      <div className="grid w-full gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex-row gap-2">
            <LuHandCoins className="text-muted-foreground" />
            <CardTitle>
              <Trans>AR Outstanding</Trans>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <HStack className="justify-between w-full items-center">
              <h3 className="text-4xl font-medium tracking-tighter tabular-nums">
                {format(ar.total)}
              </h3>
              <Button
                rightIcon={<LuArrowUpRight />}
                variant="secondary"
                asChild
              >
                <Link to={path.to.receivables}>
                  <Trans>View</Trans>
                </Link>
              </Button>
            </HStack>
            <span className="text-xs text-muted-foreground">
              {t`${ar.count} customers with a balance`}
            </span>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row gap-2">
            <LuClock className="text-muted-foreground" />
            <CardTitle>
              <Trans>AR Overdue</Trans>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <h3 className="text-4xl font-medium tracking-tighter tabular-nums">
              {format(arOverdue)}
            </h3>
            <span className="text-xs text-muted-foreground">
              {ar.total > 0
                ? t`${arOverduePct}% of receivables`
                : t`No receivables`}
            </span>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row gap-2">
            <LuHandCoins className="text-muted-foreground" />
            <CardTitle>
              <Trans>AP Outstanding</Trans>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <HStack className="justify-between w-full items-center">
              <h3 className="text-4xl font-medium tracking-tighter tabular-nums">
                {format(ap.total)}
              </h3>
              <Button
                rightIcon={<LuArrowUpRight />}
                variant="secondary"
                asChild
              >
                <Link to={path.to.payables}>
                  <Trans>View</Trans>
                </Link>
              </Button>
            </HStack>
            <span className="text-xs text-muted-foreground">
              {t`${ap.count} suppliers with a balance`}
            </span>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row gap-2">
            <LuClock className="text-muted-foreground" />
            <CardTitle>
              <Trans>AP Overdue</Trans>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <h3 className="text-4xl font-medium tracking-tighter tabular-nums">
              {format(apOverdue)}
            </h3>
            <span className="text-xs text-muted-foreground">
              {ap.total > 0 ? t`${apOverduePct}% of payables` : t`No payables`}
            </span>
          </CardContent>
        </Card>
      </div>

      {/* Aging breakdown */}
      <div className="grid w-full gap-4 grid-cols-1 lg:grid-cols-2">
        <AgingCard
          title={<Trans>Receivables aging</Trans>}
          icon={<LuClock />}
          totals={ar}
          tieOut={arTieOut}
          bucketLabels={bucketLabels}
          format={format}
        />
        <AgingCard
          title={<Trans>Payables aging</Trans>}
          icon={<LuClock />}
          totals={ap}
          tieOut={apTieOut}
          bucketLabels={bucketLabels}
          format={format}
        />
      </div>

      {/* Recent payments */}
      <Card>
        <CardHeader className="flex-row gap-2">
          <LuBanknote className="text-muted-foreground" />
          <CardTitle>
            <Trans>Recent payments</Trans>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="min-h-[120px] w-full">
            {recentPayments.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">
                <Trans>No payments yet.</Trans>
              </p>
            ) : (
              <Table>
                <Thead>
                  <Tr>
                    <Th>
                      <Trans>Date</Trans>
                    </Th>
                    <Th>
                      <Trans>Payment</Trans>
                    </Th>
                    <Th>
                      <Trans>Counterparty</Trans>
                    </Th>
                    <Th>
                      <Trans>Type</Trans>
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
                  {recentPayments.map((p) => {
                    const name =
                      p.paymentType === "Receipt"
                        ? (customerName.get(p.customerId ?? "") ?? p.customerId)
                        : (supplierName.get(p.supplierId ?? "") ??
                          p.supplierId);
                    return (
                      <Tr key={p.id}>
                        <Td>
                          {p.paymentDate ? formatDate(p.paymentDate) : "—"}
                        </Td>
                        <Td>
                          <Link
                            to={path.to.payment(p.id)}
                            className="text-primary hover:underline"
                          >
                            {p.paymentId}
                          </Link>
                        </Td>
                        <Td className="max-w-[200px] truncate">
                          {name ?? "—"}
                        </Td>
                        <Td>
                          {p.paymentType === "Receipt" ? (
                            <Trans>From customer</Trans>
                          ) : (
                            <Trans>To supplier</Trans>
                          )}
                        </Td>
                        <Td className="text-right tabular-nums">
                          {currencyFormatter.format(Number(p.totalAmount))}
                        </Td>
                        <Td>
                          <PaymentStatus status={p.status ?? undefined} />
                        </Td>
                      </Tr>
                    );
                  })}
                </Tbody>
              </Table>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default InvoicingDashboard;
