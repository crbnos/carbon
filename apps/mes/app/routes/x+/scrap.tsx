import {
  assertIsPost,
  error,
  getCarbonServiceRole,
  success,
} from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { FunctionRegion } from "@supabase/supabase-js";
import type { ActionFunctionArgs } from "@vercel/remix";
import { json } from "@vercel/remix";
import { scrapQuantityValidator } from "~/services/models";
import { insertScrapQuantity } from "~/services/operations.service";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {});

  const formData = await request.formData();
  const validation = await validator(scrapQuantityValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { trackedEntityId, trackingType, ...data } = validation.data;

  const insertScrap = await insertScrapQuantity(client, {
    ...data,
    companyId,
    createdBy: userId,
  });

  if (insertScrap.error) {
    return json(
      {},
      await flash(
        request,
        error(insertScrap.error, "Failed to record scrap quantity")
      )
    );
  }

  const issue = await getCarbonServiceRole().functions.invoke("issue", {
    body: {
      id: validation.data.jobOperationId,
      type: "jobOperation",
      quantity: validation.data.quantity,
      companyId,
      userId,
    },
    region: FunctionRegion.UsEast1,
  });

  if (issue.error) {
    throw json(
      insertScrap.data,
      await flash(request, error(issue.error, "Failed to issue materials"))
    );
  }

  return json(
    insertScrap.data,
    await flash(request, success("Scrap quantity recorded successfully"))
  );
}
