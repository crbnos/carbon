import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";
import { getMemos, MemosTable } from "~/modules/invoicing";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: "Credit / Debit Memos",
  to: path.to.memos,
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

  // The "Counterparty" column filter spans two columns (customerId OR
  // supplierId), so pull it out of the generic filters and hand it to getMemos,
  // which applies it as an OR. The rest pass through normally.
  const counterpartyIds = filters
    .filter((f) => f.column === "counterparty")
    .flatMap((f) => (f.value ?? "").split(","))
    .filter(Boolean);
  const passThroughFilters = filters.filter((f) => f.column !== "counterparty");

  const memos = await getMemos(client, companyId, {
    search,
    direction,
    status,
    counterpartyIds: counterpartyIds.length > 0 ? counterpartyIds : null,
    limit,
    offset,
    sorts,
    filters: passThroughFilters
  });

  if (memos.error) {
    throw redirect(
      path.to.invoicing,
      await flash(request, error(memos.error, "Failed to fetch memos"))
    );
  }

  return {
    count: memos.count ?? 0,
    memos: memos.data ?? []
  };
}

export default function MemosRoute() {
  const { count, memos } = useLoaderData<typeof loader>();
  return <MemosTable data={memos} count={count} />;
}
