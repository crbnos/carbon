import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, redirect, useLoaderData } from "react-router";
import {
  getSequence,
  SequenceForm,
  sequenceValidator,
  updateSequence
} from "~/modules/settings";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "settings",
    role: "employee"
  });

  const { tableId } = params;
  if (!tableId) throw notFound("tableId not found");

  const sequence = await getSequence(tableId);
  if (sequence.error) {
    throw redirect(
      path.to.sequences,
      await flash(request, error(sequence.error, "Failed to get sequence"))
    );
  }

  return {
    sequence: sequence?.data ?? null
  };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { userId } = await requirePermissions(request, {
    update: "settings"
  });

  const validation = await validator(sequenceValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { table, ...d } = validation.data;

  const update = await updateSequence(table, {
    ...d,
    updatedBy: userId
  });

  if (update.error) {
    return data(
      {},
      await flash(request, error(update.error, "Failed to update sequence"))
    );
  }

  throw redirect(
    path.to.sequences,
    await flash(request, success("Updated sequence"))
  );
}

export default function EditSequenceRoute() {
  const { sequence } = useLoaderData<typeof loader>();

  const initialValues = {
    table: sequence?.table ?? "",
    name: sequence?.name ?? "",
    prefix: sequence?.prefix ?? "",
    next: sequence?.next ?? 1,
    size: sequence?.size ?? 5,
    step: sequence?.step ?? 1,
    suffix: sequence?.suffix ?? ""
  };

  return (
    <SequenceForm key={initialValues.table} initialValues={initialValues} />
  );
}
