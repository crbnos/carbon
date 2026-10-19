// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { authorize } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, useLoaderData } from "react-router";
import { itemSerialSequenceValidator } from "~/modules/settings/settings.models";
import { upsertItemSerialSequence } from "~/modules/settings/settings.service";
import { ItemSerialSequenceForm } from "~/modules/settings/ui";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { api } = await authorize(
    request,
    { "settings.serialNumbers": "View" },
    { role: "employee" }
  );

  const { id } = params;
  if (!id) throw notFound("id not found");

  const itemSerialSequence = await api.settings.getItemSerialSequence({ id });
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
  const { client, companyId, userId } = await authorize(request, {
    "settings.serialNumbers": "Edit"
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
