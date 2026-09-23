import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";
import { getMemos, MemosTable } from "~/modules/invoicing";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

// Accounts Payable — supplier credit/debit memos. The customer side lives in
// credit-memos.tsx; both read the same `memo` table, scoped by party.
export const handle: Handle = {
  breadcrumb: "Vendor Credits",
  to: path.to.vendorCredits,
  module: "invoicing"
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "invoicing"
  });

  const url = new URL(request.url);
  const searchParams = url.searchParams;
  const search = searchParams.get("search");
  const direction = searchParams.get("direction") as "Credit" | "Debit" | null;
  const status = searchParams.get("status") as
    | "Draft"
    | "Posted"
    | "Voided"
    | null;

  const {
    limit,
    offset,
    sorts,
    filters = []
  } = getGenericQueryFilters(searchParams);

  // The "Supplier" column filter is keyed as "counterparty"; pull it out and
  // hand it to getMemos, which applies it to supplierId. The rest pass through.
  const counterpartyIds = filters
    .filter((f) => f.column === "counterparty")
    .flatMap((f) => (f.value ?? "").split(","))
    .filter(Boolean);
  const passThroughFilters = filters.filter((f) => f.column !== "counterparty");

  const memos = await getMemos(client, companyId, {
    search,
    direction,
    status,
    party: "supplier",
    counterpartyIds: counterpartyIds.length > 0 ? counterpartyIds : null,
    limit,
    offset,
    sorts,
    filters: passThroughFilters
  });

  if (memos.error) {
    throw redirect(
      path.to.invoicing,
      await flash(request, error(memos.error, "Failed to fetch vendor credits"))
    );
  }

  return {
    count: memos.count ?? 0,
    memos: memos.data ?? []
  };
}

export default function VendorCreditsRoute() {
  const { count, memos } = useLoaderData<typeof loader>();
  return <MemosTable data={memos} count={count} party="supplier" />;
}
