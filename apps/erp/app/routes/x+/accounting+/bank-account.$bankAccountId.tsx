import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  HStack,
  VStack
} from "@carbon/react";
import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import { LuCirclePlus } from "react-icons/lu";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";
import { usePermissions } from "~/hooks";
import {
  companyBankAccountValidator,
  getBankTransactions,
  getCompanyBankAccount,
  getUnmatchedJournalLineCandidates,
  upsertCompanyBankAccount
} from "~/modules/accounting";
import type { BankTransactionListItem } from "~/modules/accounting/types";
import {
  BankStatementUpload,
  BankTransactionForm,
  BankTransactionMatchModal,
  BankTransactionsTable,
  CompanyBankAccountForm
} from "~/modules/accounting/ui/BankReconciliation";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Bank Account`,
  to: path.to.bankAccounts
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "accounting"
  });

  const { bankAccountId } = params;
  if (!bankAccountId) throw notFound("bankAccountId not found");

  const [account, transactions] = await Promise.all([
    getCompanyBankAccount(client, bankAccountId),
    getBankTransactions(client, bankAccountId)
  ]);

  if (account.error) {
    throw redirect(
      path.to.bankAccounts,
      await flash(request, error(account.error, "Failed to get bank account"))
    );
  }

  // Only needed for the manual-match picker — skip the query when nothing on
  // this account is unmatched.
  const hasUnmatched = (transactions.data ?? []).some(
    (txn) => txn.status === "Unmatched"
  );
  const candidates = hasUnmatched
    ? await getUnmatchedJournalLineCandidates(
        client,
        companyId,
        account.data.glAccountId
      )
    : { data: [] };

  return {
    account: account.data,
    transactions: transactions.data ?? [],
    candidates: candidates.data ?? []
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "accounting"
  });

  const { bankAccountId } = params;
  if (!bankAccountId) throw notFound("bankAccountId not found");

  const formData = await request.formData();
  const validation = await validator(companyBankAccountValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...rest } = validation.data;

  const result = await upsertCompanyBankAccount(client, {
    id: id ?? bankAccountId,
    ...rest,
    updatedBy: userId
  });

  if (result.error) {
    throw redirect(
      path.to.bankAccount(bankAccountId),
      await flash(request, error(result.error, "Failed to update bank account"))
    );
  }

  throw redirect(
    path.to.bankAccount(bankAccountId),
    await flash(request, success("Bank account updated"))
  );
}

export default function BankAccountRoute() {
  const { account, transactions, candidates } = useLoaderData<typeof loader>();
  const { t } = useLingui();
  const permissions = usePermissions();
  const [isEditing, setIsEditing] = useState(false);
  const [isAddingTransaction, setIsAddingTransaction] = useState(false);
  const [matchingTransaction, setMatchingTransaction] =
    useState<BankTransactionListItem | null>(null);

  // Full-page form submissions redirect back to this same route, so the
  // component doesn't remount — close any open modal once the save lands.
  useEffect(() => {
    setIsEditing(false);
    setIsAddingTransaction(false);
    setMatchingTransaction(null);
  }, [account.updatedAt, transactions]);

  const matchedCount = transactions.filter(
    (txn) => txn.status === "Matched"
  ).length;

  return (
    <VStack spacing={4} className="p-4">
      <Card>
        <CardHeader>
          <HStack className="justify-between">
            <CardTitle>{account.name}</CardTitle>
            {permissions.can("update", "accounting") && (
              <Button variant="secondary" onClick={() => setIsEditing(true)}>
                {t`Edit`}
              </Button>
            )}
          </HStack>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {t`Currency: ${account.currencyCode}`} ·{" "}
            {t`${matchedCount} of ${transactions.length} transactions matched`}
          </p>
        </CardContent>
      </Card>

      <BankStatementUpload companyBankAccountId={account.id} />

      <BankTransactionsTable
        data={transactions}
        currencyCode={account.currencyCode}
        companyBankAccountId={account.id}
        onMatch={(transaction) => setMatchingTransaction(transaction)}
        primaryAction={
          permissions.can("create", "accounting") && (
            <Button
              leftIcon={<LuCirclePlus />}
              variant="secondary"
              onClick={() => setIsAddingTransaction(true)}
            >
              {t`Add Transaction`}
            </Button>
          )
        }
      />

      {isEditing && (
        <CompanyBankAccountForm
          type="modal"
          initialValues={{
            id: account.id,
            name: account.name,
            glAccountId: account.glAccountId,
            currencyCode: account.currencyCode,
            active: account.active
          }}
          onClose={() => setIsEditing(false)}
        />
      )}

      {isAddingTransaction && (
        <BankTransactionForm
          companyBankAccountId={account.id}
          onClose={() => setIsAddingTransaction(false)}
        />
      )}

      {matchingTransaction && (
        <BankTransactionMatchModal
          companyBankAccountId={account.id}
          transactionId={matchingTransaction.id}
          transactionDescription={matchingTransaction.description}
          transactionAmount={matchingTransaction.amount}
          transactionPostedDate={matchingTransaction.postedDate}
          currencyCode={account.currencyCode}
          candidates={candidates}
          onClose={() => setMatchingTransaction(null)}
        />
      )}
    </VStack>
  );
}
