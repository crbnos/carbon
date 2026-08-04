import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, redirect, useLoaderData } from "react-router";
import {
  getItemSerialSequences,
  ItemSerialSequenceForm,
  itemSerialSequenceValidator,
  upsertItemSerialSequence
} from "~/modules/settings";
import { path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    create: "settings",
    role: "employee"
  });

  // Items that already have a sequence can't get a second one.
  const existing = await getItemSerialSequences(client, companyId, {
    search: null,
    limit: 1000,
    offset: 0,
    sorts: [],
    filters: []
  });

  return {
    configuredItemIds: (existing.data ?? [])
      .map((s) => s.itemId)
      .filter((id): id is string => id !== null)
  };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "settings"
  });

  const validation = await validator(itemSerialSequenceValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id: _id, ...d } = validation.data;

  const create = await upsertItemSerialSequence(client, {
    ...d,
    companyId,
    createdBy: userId
  });

  if (create.error) {
    return data(
      {},
      await flash(
        request,
        error(create.error, "Failed to create serial number")
      )
    );
  }

  throw redirect(
    path.to.serialNumberSequences,
    await flash(request, success("Created serial number"))
  );
}

export default function NewSerialNumberRoute() {
  const { configuredItemIds } = useLoaderData<typeof loader>();

  const initialValues = {
    itemId: "",
    prefix: "",
    suffix: "",
    next: 0,
    size: 5,
    step: 1
  };

  return (
    <ItemSerialSequenceForm
      initialValues={initialValues}
      configuredItemIds={configuredItemIds}
    />
  );
}
