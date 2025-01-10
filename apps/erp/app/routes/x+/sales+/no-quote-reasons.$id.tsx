import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { useLoaderData, useNavigate } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import {
  getNoQuoteReason,
  noQuoteReasonValidator,
  upsertNoQuoteReason,
} from "~/modules/sales";
import NoQuoteReasonForm from "~/modules/sales/ui/NoQuoteReasons/NoQuoteReasonForm";

import { getCustomFields, setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "sales",
    role: "employee",
  });

  const { id } = params;
  if (!id) throw notFound("id not found");

  const noQuoteReason = await getNoQuoteReason(client, id);

  if (noQuoteReason.error) {
    throw redirect(
      path.to.noQuoteReasons,
      await flash(
        request,
        error(noQuoteReason.error, "Failed to get no quote reason")
      )
    );
  }

  return json({
    noQuoteReason: noQuoteReason.data,
  });
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "sales",
  });

  const formData = await request.formData();
  const validation = await validator(noQuoteReasonValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...data } = validation.data;
  if (!id) throw new Error("id not found");

  const updateNoQuoteReason = await upsertNoQuoteReason(client, {
    id,
    ...data,
    updatedBy: userId,
    customFields: setCustomFields(formData),
  });

  if (updateNoQuoteReason.error) {
    return json(
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
    ...getCustomFields(noQuoteReason.customFields),
  };

  return (
    <NoQuoteReasonForm
      key={initialValues.id}
      initialValues={initialValues}
      onClose={() => navigate(-1)}
    />
  );
}
