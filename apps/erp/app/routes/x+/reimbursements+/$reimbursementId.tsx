// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { isUnaffectedByNavigation, redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import type {
  LoaderFunctionArgs,
  ShouldRevalidateFunction
} from "react-router";
import { Outlet, useLoaderData } from "react-router";
import { DocumentPage, DocumentSidebar } from "~/components/DocumentPage";
import {
  getActiveDimensionsWithValues,
  getDefaultAccounts
} from "~/modules/accounting";
import {
  getOpenReimbursementsForEmployee,
  getReimbursement,
  getReimbursementRelatedItems,
  ReimbursementDocuments,
  ReimbursementHeader
} from "~/modules/invoicing";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Reimbursements`,
  to: path.to.reimbursements,
  module: "invoicing"
};

export const shouldRevalidate: ShouldRevalidateFunction = (args) =>
  isUnaffectedByNavigation(args, { params: ["reimbursementId"] })
    ? false
    : args.defaultShouldRevalidate;

/**
 * Loads the document for the whole page — the header, the Documents panel,
 * read mode (`$reimbursementId._index.tsx`) and edit mode
 * (`$reimbursementId.edit.tsx`) all read it through
 * `useRouteData(path.to.reimbursement(id))`. Edit mode keeps its own loader
 * only for the update permission and the Draft-only lock on a direct URL.
 */
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
            .select("id, journalEntryId, status")
            .eq("id", reimbursement.data.journalId)
            .eq("companyId", companyId)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      // Provider origin badge. Keyed on the document's OWN provider
      // (`reimbursement.integration`, the same value DocumentSourceBadge
      // renders) — a hard-coded id finds no mapping for any spend provider
      // other than that one, so the badge would silently lose its external id
      // and deep link. Read via the user-scoped client — if RLS denies (or
      // there is no mapping), fall back to null silently so the SOURCE badge
      // degrades to the provider name rather than throwing.
      client
        .from("externalIntegrationMapping")
        .select("id, externalId, metadata")
        .eq("companyId", companyId)
        .eq("integration", reimbursement.data.integration)
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
    defaultBankAccount: defaults.data?.bankCashAccount ?? "",
    relatedItems: getReimbursementRelatedItems(
      client,
      companyId,
      reimbursementId
    )
  };
}

export default function ReimbursementRoute() {
  const { reimbursement } = useLoaderData<typeof loader>();
  return (
    <DocumentPage
      header={<ReimbursementHeader />}
      sidebar={
        <DocumentSidebar
          documents={<ReimbursementDocuments />}
          activity={{
            entityType: "reimbursement",
            entityId: reimbursement.id,
            refreshKey: `${reimbursement.updatedAt ?? ""}:${reimbursement.status}`
          }}
        />
      }
    >
      <Outlet />
    </DocumentPage>
  );
}
