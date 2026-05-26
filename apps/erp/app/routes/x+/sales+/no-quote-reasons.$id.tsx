import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, redirect, useLoaderData, useNavigate } from "react-router";
import { noQuoteReasonValidator } from "~/modules/sales";
import {
  getNoQuoteReason,
  upsertNoQuoteReason
} from "~/modules/sales/sales.service.server";
import NoQuoteReasonForm from "~/modules/sales/ui/NoQuoteReasons/NoQuoteReasonForm";

import { getCustomFields, setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "sales",
    role: "employee"
  });

  const { id } = params;
  if (!id) throw notFound("id not found");

  const noQuoteReason = await getNoQuoteReason(id);

  if (noQuoteReason.error) {
    throw redirect(
      path.to.noQuoteReasons,
      await flash(
        request,
        error(noQuoteReason.error, "Failed to get no quote reason")
      )
    );
  }

  return {
    noQuoteReason: noQuoteReason.data
  };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { userId } = await requirePermissions(request, {
    update: "sales"
  });

  const formData = await request.formData();
  const validation = await validator(noQuoteReasonValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...d } = validation.data;
  if (!id) throw new Error("id not found");

  const updateNoQuoteReason = await upsertNoQuoteReason({
    id,
    ...d,
    updatedBy: userId,
    customFields: setCustomFields(formData)
  });

  if (updateNoQuoteReason.error) {
    return data(
      {},
      await flash(
        request,
        error(updateNoQuoteReason.error, "Failed to update no quote reason")
      )
    );
  }

  throw redirect(
    path.to.noQuoteReasons,
    await flash(request, success("Updated no quote reason"))
  );
}

export default function EditNoQuoteReasonRoute() {
  const { noQuoteReason } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  const initialValues = {
    id: noQuoteReason.id ?? undefined,
    name: noQuoteReason.name ?? "",
    ...getCustomFields(noQuoteReason.customFields)
  };

  return (
    <NoQuoteReasonForm
      key={initialValues.id}
      initialValues={initialValues}
      onClose={() => navigate(-1)}
    />
  );
}
