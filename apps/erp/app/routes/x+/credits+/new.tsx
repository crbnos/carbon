import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";
import { MemoForm, memoValidator, upsertMemo } from "~/modules/invoicing";
import { getCompany, getNextSequence } from "~/modules/settings";
import { setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    create: "invoicing"
  });

  const company = await getCompany(client, companyId);
  const currencyCode = company.data?.baseCurrencyCode ?? "";

  return {
    initialValues: {
      memoId: "",
      direction: "Credit" as const,
      customerId: "",
      supplierId: "",
      memoDate: new Date().toISOString().slice(0, 10),
      currencyCode,
      exchangeRate: 1,
      amount: 0,
      reference: "",
      notes: ""
    }
  };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "invoicing"
  });

  const formData = await request.formData();
  const validation = await validator(memoValidator).validate(formData);
  if (validation.error) {
    return validationError(validation.error);
  }

  let memoId = validation.data.memoId;
  if (!memoId) {
    const next = await getNextSequence(
      client,
      validation.data.direction === "Credit" ? "creditMemo" : "debitMemo",
      companyId
    );
    if (next.error || !next.data) {
      throw redirect(
        path.to.memos,
        await flash(request, error(next.error, "Failed to allocate memo id"))
      );
    }
    memoId = next.data;
  }

  // The form posts a hidden `id` as "" which validates to null. The create
  // branch must omit it so the table's xid() default generates the id.
  const { id: _omitId, ...memoData } = validation.data;

  const insert = await upsertMemo(client, {
    ...memoData,
    memoId,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData)
  });
  if (insert.error || !insert.data) {
    throw redirect(
      path.to.memos,
      await flash(request, error(insert.error, "Failed to create memo"))
    );
  }

  throw redirect(
    path.to.memo(insert.data.id),
    await flash(request, success("Memo created"))
  );
}

export default function NewMemoRoute() {
  const { initialValues } = useLoaderData<typeof loader>();
  return (
    <div className="max-w-4xl w-full p-2 sm:p-0 mx-auto mt-0 md:mt-8">
      <MemoForm initialValues={initialValues} />
    </div>
  );
}
