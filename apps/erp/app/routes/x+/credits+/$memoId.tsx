import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { VStack } from "@carbon/react";
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

export const handle: Handle = {
  breadcrumb: "Credit / Debit Memos",
  to: path.to.memos
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
      path.to.memos,
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
      path.to.memos,
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

  return (
    <VStack spacing={4} className="p-6 max-w-6xl w-full mx-auto">
      <MemoForm initialValues={initialValues} />
      <MemoApplicationsPanel
        rows={applications}
        currencyCode={memo.currencyCode ?? "USD"}
      />
    </VStack>
  );
}
