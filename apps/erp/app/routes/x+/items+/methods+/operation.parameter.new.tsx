import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { upsertMethodOperationParameter } from "~/modules/items";
import { checkRevisionLock } from "~/modules/items/items.server";
import { operationParameterValidator } from "~/modules/shared";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "parts"
  });

  const formData = await request.formData();
  const validation = await validator(operationParameterValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  // Release-lock gate: enforce -> block; warn -> proceed + flash; off -> no-op.
  const lock = await checkRevisionLock(client, {
    kind: "operation",
    id: validation.data.operationId,
    companyId
  });
  if (!lock.ok) {
    return data({ id: null }, await flash(request, error(null, lock.message)));
  }

  const insert = await upsertMethodOperationParameter(client, {
    ...validation.data,
    companyId,
    createdBy: userId
  });
  if (insert.error) {
    return data(
      {
        id: null
      },
      await flash(
        request,
        error(insert.error, "Failed to insert method operation parameter")
      )
    );
  }

  const methodOperationParameterId = insert.data?.id;
  if (!methodOperationParameterId) {
    return data(
      {
        id: null
      },
      await flash(
        request,
        error(insert.error, "Failed to insert method operation parameter")
      )
    );
  }

  if (lock.warn) {
    return data(
      { id: methodOperationParameterId },
      await flash(request, success(lock.message))
    );
  }

  return { id: methodOperationParameterId };
}
