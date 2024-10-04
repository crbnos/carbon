import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "@vercel/remix";
import { json } from "@vercel/remix";
import {
  insertReworkQuantity,
  nonScrapQuantityValidator,
} from "~/services/jobs.service";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "accounting",
  });

  const formData = await request.formData();
  const validation = await validator(nonScrapQuantityValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const insertRework = await insertReworkQuantity(client, {
    ...validation.data,
    companyId,
    createdBy: userId,
  });

  if (insertRework.error) {
    return json(
      {},
      await flash(
        request,
        error(insertRework.error, "Failed to record rework quantity")
      )
    );
  }

  return json(
    insertRework.data,
    await flash(request, success("Rework quantity recorded successfully"))
  );
}
