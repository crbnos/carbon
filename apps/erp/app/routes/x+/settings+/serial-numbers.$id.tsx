import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, redirect, useLoaderData } from "react-router";
import {
  getItemSerialSequence,
  ItemSerialSequenceForm,
  itemSerialSequenceValidator,
  upsertItemSerialSequence
} from "~/modules/settings";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "settings",
    role: "employee"
  });

  const { id } = params;
  if (!id) throw notFound("id not found");

  const itemSerialSequence = await getItemSerialSequence(client, id, companyId);
  if (itemSerialSequence.error) {
    throw redirect(
      path.to.serialNumberSequences,
      await flash(
        request,
        error(itemSerialSequence.error, "Failed to get serial number")
      )
    );
  }

  return { itemSerialSequence: itemSerialSequence.data };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "settings"
  });

  const { id } = params;
  if (!id) throw notFound("id not found");

  const validation = await validator(itemSerialSequenceValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id: _id, ...d } = validation.data;

  const update = await upsertItemSerialSequence(client, {
    id,
    ...d,
    companyId,
    updatedBy: userId
  });

  if (update.error) {
    return data(
      {},
      await flash(
        request,
        error(update.error, "Failed to update serial number")
      )
    );
  }

  throw redirect(
    path.to.serialNumberSequences,
    await flash(request, success("Updated serial number"))
  );
}

export default function EditSerialNumberRoute() {
  const { itemSerialSequence } = useLoaderData<typeof loader>();

  const initialValues = {
    id: itemSerialSequence.id ?? undefined,
    itemId: itemSerialSequence.itemId ?? "",
    prefix: itemSerialSequence.prefix ?? "",
    suffix: itemSerialSequence.suffix ?? "",
    next: itemSerialSequence.next ?? 0,
    size: itemSerialSequence.size ?? 5,
    step: itemSerialSequence.step ?? 1
  };

  return (
    <ItemSerialSequenceForm
      key={initialValues.id}
      initialValues={initialValues}
    />
  );
}
