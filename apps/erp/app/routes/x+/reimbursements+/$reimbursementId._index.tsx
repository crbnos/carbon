import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { Button, HStack, useDisclosure, VStack } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Form, Link, redirect, useLoaderData } from "react-router";
import { Confirm } from "~/components/Modals";
import { usePermissions } from "~/hooks";
import {
  getActiveDimensionsWithValues,
  getDefaultAccounts
} from "~/modules/accounting";
import {
  getOpenReimbursementsForEmployee,
  getReimbursement,
  PayExpenseModal,
  ReimbursementSummary
} from "~/modules/invoicing";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId, companyGroupId } = await requirePermissions(
    request,
    {
      view: "invoicing"
    }
  );

  const { reimbursementId } = params;
  if (!reimbursementId) throw new Error("Could not find reimbursementId");

  const reimbursement = await getReimbursement(
    client,
    companyId,
    reimbursementId
  );
  if (reimbursement.error || !reimbursement.data) {
    throw redirect(
      path.to.reimbursements,
      await flash(
        request,
        error(reimbursement.error, "Failed to load reimbursement")
      )
    );
  }

  const lines = reimbursement.data.reimbursementLine ?? [];

  // One query for every referenced account instead of N+1.
  const accountIds = lines
    .map((line) => line.accountId)
    .filter((value): value is string => Boolean(value));

  const [accounts, journal, mapping, dimensions, openBalances, defaults] =
    await Promise.all([
      accountIds.length > 0
        ? client
            .from("account")
            .select("id, number, name")
            .eq("companyGroupId", companyGroupId)
            .in("id", [...new Set(accountIds)])
        : Promise.resolve({
            data: [] as { id: string; number: string | null; name: string }[],
            error: null
          }),
      reimbursement.data.journalId
        ? client
            .from("journal")
            .select("id, journalEntryId")
            .eq("id", reimbursement.data.journalId)
            .eq("companyId", companyId)
            .maybeSingle()
        : Promise.resolve({
            data: null as { id: string; journalEntryId: string } | null,
            error: null
          }),
      // Provider origin badge. Read via the user-scoped client — if RLS denies
      // (or there is no mapping), fall back to null silently so the SOURCE
      // badge degrades to the provider name rather than throwing.
      client
        .from("externalIntegrationMapping")
        .select("id, externalId, metadata")
        .eq("companyId", companyId)
        .eq("integration", "ramp")
        .eq("entityType", "reimbursement")
        .eq("entityId", reimbursementId)
        .maybeSingle(),
      getActiveDimensionsWithValues(client, companyGroupId, companyId),
      // What is still owed. Only a Posted reimbursement has a booked payable,
      // and the balance is what decides whether "Pay expense" is offered at all
      // — there is no `paidAmount` column; the settlement rows are the truth.
      reimbursement.data.status === "Posted"
        ? getOpenReimbursementsForEmployee(
            client,
            companyId,
            reimbursement.data.employeeId,
            reimbursement.data.currencyCode
          )
        : Promise.resolve({
            data: [] as Awaited<
              ReturnType<typeof getOpenReimbursementsForEmployee>
            >["data"],
            error: null
          }),
      getDefaultAccounts(client, companyId)
    ]);

  const auxiliaryError = accounts.error ?? journal.error;
  if (auxiliaryError) {
    throw redirect(
      path.to.reimbursements,
      await flash(
        request,
        error(auxiliaryError, "Failed to load reimbursement")
      )
    );
  }

  const accountsById = Object.fromEntries(
    (accounts.data ?? []).map((account) => [account.id, account])
  );

  // A balance read that fails degrades to "nothing due" — the Pay expense
  // action disappears rather than the whole page redirecting away.
  const balanceDue =
    (openBalances.data ?? []).find((r) => r.id === reimbursementId)
      ?.remainingDocument ?? 0;

  return {
    reimbursement: reimbursement.data,
    lines,
    accountsById,
    journal: journal.data,
    mapping: mapping.data as {
      externalId: string | null;
      metadata: { deepLink?: string } | null;
    } | null,
    dimensions: dimensions.data ?? [],
    balanceDue,
    defaultBankAccount: defaults.data?.bankCashAccount ?? ""
  };
}

export default function ReimbursementDetailRoute() {
  const {
    reimbursement,
    lines,
    accountsById,
    journal,
    mapping,
    dimensions,
    balanceDue,
    defaultBankAccount
  } = useLoaderData<typeof loader>();
  const { t } = useLingui();
  const permissions = usePermissions();
  const voidModal = useDisclosure();
  const payModal = useDisclosure();

  const canUpdate = permissions.can("update", "invoicing");
  const isDraft = reimbursement.status === "Draft";
  const canPost = isDraft && canUpdate;
  const canVoid = reimbursement.status === "Posted" && canUpdate;
  // Posted and still owed. `balanceDue` comes from the settlement rows, so a
  // fully paid reimbursement simply stops offering the action.
  const canPay =
    reimbursement.status === "Posted" &&
    balanceDue > 0 &&
    permissions.can("create", "invoicing");

  return (
    <VStack spacing={4} className="w-full">
      <HStack className="w-full justify-end">
        {canPay && (
          <Button variant="primary" onClick={payModal.onOpen}>
            <Trans>Pay expense</Trans>
          </Button>
        )}
        {isDraft && canUpdate && (
          <Button variant="secondary" asChild>
            <Link to={path.to.reimbursementEdit(reimbursement.id)}>
              <Trans>Edit</Trans>
            </Link>
          </Button>
        )}
        {canPost && (
          <Form
            method="post"
            action={path.to.reimbursementPost(reimbursement.id)}
          >
            <Button type="submit" variant="primary">
              <Trans>Post</Trans>
            </Button>
          </Form>
        )}
        {canVoid && (
          <Button variant="destructive" onClick={voidModal.onOpen}>
            <Trans>Void</Trans>
          </Button>
        )}
      </HStack>

      <ReimbursementSummary
        reimbursement={reimbursement}
        lines={lines}
        accountsById={accountsById}
        journal={journal}
        mapping={mapping}
        availableDimensions={dimensions}
      />

      {canPay && payModal.isOpen && (
        <PayExpenseModal
          id={reimbursement.id}
          displayId={reimbursement.reimbursementId}
          currencyCode={reimbursement.currencyCode}
          balanceDue={balanceDue}
          defaultBankAccount={defaultBankAccount}
          open={payModal.isOpen}
          onClose={payModal.onClose}
        />
      )}

      {canVoid && voidModal.isOpen && (
        <Confirm
          action={path.to.reimbursementVoid(reimbursement.id)}
          title={t`Void Reimbursement`}
          text={t`Are you sure you want to void ${reimbursement.reimbursementId}? This posts a reversing journal entry and cannot be undone.`}
          confirmText={t`Void`}
          confirmVariant="destructive"
          onCancel={voidModal.onClose}
          onSubmit={voidModal.onClose}
        />
      )}
    </VStack>
  );
}
