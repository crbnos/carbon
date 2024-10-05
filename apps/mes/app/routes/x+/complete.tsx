import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "@vercel/remix";
import { json } from "@vercel/remix";
import {
  insertProductionQuantity,
  nonScrapQuantityValidator,
} from "~/services/jobs.service";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {});

  const formData = await request.formData();
  const validation = await validator(nonScrapQuantityValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const insertProduction = await insertProductionQuantity(client, {
    ...validation.data,
    companyId,
    createdBy: userId,
  });

  if (insertProduction.error) {
    return json(
      {},
      await flash(
        request,
        error(insertProduction.error, "Failed to record production quantity")
      )
    );
  }

  return json(
    insertProduction.data,
    await flash(request, success("Production quantity recorded successfully"))
  );
}
