import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import {
  Button,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  HStack,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  VStack
} from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import type { LoaderFunctionArgs } from "react-router";
import { redirect, useFetcher, useLoaderData, useNavigate } from "react-router";
import { Enumerable } from "~/components/Enumerable";
import { useCurrencyFormatter, usePermissions } from "~/hooks";
import { CardTransactionStatus, getCardTransaction } from "~/modules/invoicing";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "invoicing"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const cardTransaction = await getCardTransaction(client, id);
  if (cardTransaction.error || !cardTransaction.data) {
    throw redirect(
      path.to.cardTransactions,
      await flash(
        request,
        error(cardTransaction.error, "Failed to load card transaction")
      )
    );
  }

  const lines = cardTransaction.data.cardTransactionLine ?? [];

  // One query for every referenced account (header + lines) instead of N+1.
  const accountIds = [
    cardTransaction.data.cardAccountId,
    cardTransaction.data.offsetAccountId,
    ...lines.map((line) => line.accountId)
  ].filter((value): value is string => Boolean(value));

  const [accounts, receipts] = await Promise.all([
    accountIds.length > 0
      ? client
          .from("account")
          .select("id, number, name")
          .eq("companyId", companyId)
          .in("id", [...new Set(accountIds)])
      : Promise.resolve({
          data: [] as { id: string; number: string; name: string }[]
        }),
    client
      .from("document")
      .select("id, name, path")
      .eq("companyId", companyId)
      .ilike("path", `${companyId}/card-transaction/${id}/%`)
  ]);

  const accountsById = Object.fromEntries(
    (accounts.data ?? []).map((account) => [account.id, account])
  );

  return {
    cardTransaction: cardTransaction.data,
    lines,
    accountsById,
    receipts: receipts.data ?? []
  };
}

export default function CardTransactionDetailRoute() {
  const { cardTransaction, lines, accountsById, receipts } =
    useLoaderData<typeof loader>();
  const { t } = useLingui();
  const { locale } = useLocale();
  const navigate = useNavigate();
  const permissions = usePermissions();
  const voidFetcher = useFetcher<{}>();
  const currencyFormatter = useCurrencyFormatter({
    currency: cardTransaction.currencyCode
  });

  const accountLabel = (accountId: string | null) => {
    if (!accountId) return null;
    const account = accountsById[accountId];
    return account ? `${account.number} ${account.name}` : accountId;
  };

  const canVoid =
    cardTransaction.status === "Posted" &&
    permissions.can("update", "invoicing");

  return (
    <Drawer
      open
      onOpenChange={(open) => {
        if (!open) navigate(path.to.cardTransactions);
      }}
    >
      <DrawerContent size="lg">
        <DrawerHeader>
          <DrawerTitle>{cardTransaction.cardTransactionId}</DrawerTitle>
        </DrawerHeader>
        <DrawerBody>
          <VStack spacing={4}>
            <HStack spacing={2}>
              <Enumerable value={cardTransaction.type} />
              <CardTransactionStatus status={cardTransaction.status} />
            </HStack>

            <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm w-full">
              <dt className="text-muted-foreground">
                <Trans>Merchant</Trans>
              </dt>
              <dd>{cardTransaction.merchantName ?? "—"}</dd>

              <dt className="text-muted-foreground">
                <Trans>Card Holder</Trans>
              </dt>
              <dd>{cardTransaction.cardHolderName ?? "—"}</dd>

              <dt className="text-muted-foreground">
                <Trans>Transaction Date</Trans>
              </dt>
              <dd>
                {formatDate(cardTransaction.transactionDate, undefined, locale)}
              </dd>

              <dt className="text-muted-foreground">
                <Trans>Amount</Trans>
              </dt>
              <dd className="tabular-nums">
                {currencyFormatter.format(Number(cardTransaction.amount))}
              </dd>

              {cardTransaction.journalId && (
                <>
                  <dt className="text-muted-foreground">
                    <Trans>Journal</Trans>
                  </dt>
                  <dd>{cardTransaction.journalId}</dd>
                </>
              )}
            </dl>

            <div className="w-full">
              <Table>
                <Thead>
                  <Tr>
                    <Th>
                      <Trans>Account</Trans>
                    </Th>
                    <Th>
                      <Trans>Cost Center</Trans>
                    </Th>
                    <Th>
                      <Trans>Description</Trans>
                    </Th>
                    <Th className="text-right">
                      <Trans>Amount</Trans>
                    </Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {lines.length === 0 ? (
                    <Tr>
                      <Td
                        colSpan={4}
                        className="text-center text-muted-foreground"
                      >
                        <Trans>No lines</Trans>
                      </Td>
                    </Tr>
                  ) : (
                    lines.map((line) => (
                      <Tr key={line.id}>
                        <Td>{accountLabel(line.accountId)}</Td>
                        <Td>{line.costCenterId ?? "—"}</Td>
                        <Td>{line.description ?? "—"}</Td>
                        <Td className="text-right tabular-nums">
                          {currencyFormatter.format(Number(line.amount))}
                        </Td>
                      </Tr>
                    ))
                  )}
                </Tbody>
              </Table>
            </div>

            {receipts.length > 0 && (
              <VStack spacing={1} className="w-full">
                <span className="text-sm text-muted-foreground">
                  <Trans>Receipts</Trans>
                </span>
                {receipts.map((receipt) => (
                  <a
                    key={receipt.id}
                    href={path.to.file.previewFile(`private/${receipt.path}`)}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm text-primary hover:underline"
                  >
                    {receipt.name}
                  </a>
                ))}
              </VStack>
            )}
          </VStack>
        </DrawerBody>
        <DrawerFooter>
          <HStack>
            {canVoid && (
              <voidFetcher.Form
                method="post"
                action={path.to.cardTransactionVoid(cardTransaction.id)}
              >
                <Button
                  type="submit"
                  variant="destructive"
                  isDisabled={voidFetcher.state !== "idle"}
                >
                  <Trans>Void</Trans>
                </Button>
              </voidFetcher.Form>
            )}
            <Button
              variant="secondary"
              onClick={() => navigate(path.to.cardTransactions)}
            >
              {t`Close`}
            </Button>
          </HStack>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
