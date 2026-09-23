import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, redirect, useLoaderData } from "react-router";
import {
  getMemo,
  getMemoApplications,
  MemoApplicationsPanel,
  MemoForm,
  memoValidator,
  upsertMemo
} from "~/modules/invoicing";
import { setCustomFields } from "~/utils/form";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

// The memo detail page is one shared URL (so every inbound path.to.memo(id)
// link keeps working), but its crumb is party-aware: supplier memos are Vendor
// Credits (AP), customer memos are Credit Memos (AR), followed by the memo id.
export const handle: Handle = {
  breadcrumb: (_params: unknown, data: unknown) => {
    const memo = (
      data as
        | { memo?: { supplierId?: string | null; memoId?: string } }
        | undefined
    )?.memo;
    return [
      memo?.supplierId
        ? { breadcrumb: msg`Vendor Credits`, to: path.to.vendorCredits }
        : { breadcrumb: msg`Credit Memos`, to: path.to.creditMemos },
      { breadcrumb: memo?.memoId }
    ];
  },
  module: "invoicing"
};

// A memo is just the credit/debit document — create it, then post it. Applying
// it to invoices happens on the payment/receipt screen (alongside cash), so the
// settlement UI lives in one place. The invoice's "Applied" panel shows where a
// posted credit ended up.
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "invoicing"
  });
  const { memoId } = params;
  if (!memoId) throw notFound("Missing memoId");

  const memo = await getMemo(client, memoId);
  if (memo.error || !memo.data) {
    throw redirect(
      path.to.invoicing,
      await flash(request, error(memo.error, "Failed to load memo"))
    );
  }

  const applications = await getMemoApplications(client, memoId);

  return { memo: memo.data, applications: applications.data ?? [] };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "invoicing"
  });
  const { memoId } = params;
  if (!memoId) throw notFound("Missing memoId");

  const formData = await request.formData();
  const validation = await validator(memoValidator).validate(formData);
  if (validation.error) {
    return validationError(validation.error);
  }

  // Only Draft memos are editable; Posted/Voided are immutable.
  const existing = await getMemo(client, memoId);
  if (existing.error || !existing.data) {
    throw redirect(
      path.to.invoicing,
      await flash(request, error(existing.error, "Failed to load memo"))
    );
  }
  if (existing.data.status !== "Draft") {
    throw redirect(
      path.to.memo(memoId),
      await flash(request, error(null, "Only draft memos can be edited"))
    );
  }

  const { id: _omitId, ...memoData } = validation.data;
  const update = await upsertMemo(client, {
    ...memoData,
    id: memoId,
    updatedBy: userId,
    customFields: setCustomFields(formData)
  });
  if (update.error) {
    return data(
      {},
      await flash(request, error(update.error, "Failed to update memo"))
    );
  }

  throw redirect(
    path.to.memo(memoId),
    await flash(request, success("Memo updated"))
  );
}

export default function MemoDetailRoute() {
  const { memo, applications } = useLoaderData<typeof loader>();

  const initialValues = {
    id: memo.id,
    memoId: memo.memoId,
    direction: memo.direction,
    customerId: memo.customerId ?? "",
    supplierId: memo.supplierId ?? "",
    memoDate: memo.memoDate,
    currencyCode: memo.currencyCode ?? "",
    exchangeRate: Number(memo.exchangeRate ?? 1),
    amount: Number(memo.amount ?? 0),
    reference: memo.reference ?? "",
    notes: memo.notes ?? "",
    status: memo.status ?? undefined
  };

  const type = memo.supplierId ? "vendorCredit" : "creditMemo";

  return (
    <VStack spacing={4} className="p-6 max-w-6xl w-full mx-auto">
      <MemoForm initialValues={initialValues} type={type} />
      <MemoApplicationsPanel
        rows={applications}
        currencyCode={memo.currencyCode ?? "USD"}
      />
    </VStack>
  );
}
