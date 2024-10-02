import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "@vercel/remix";
import { json } from "@vercel/remix";
import {
  insertScrapQuantity,
  scrapQuantityValidator,
} from "~/services/jobs.service";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "accounting",
  });

  const formData = await request.formData();
  const validation = await validator(scrapQuantityValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const insertScrap = await insertScrapQuantity(client, {
    ...validation.data,
    companyId,
    createdBy: userId,
  });

  if (insertScrap.error) {
    return json(
      {},
      await flash(request, error("Failed to record scrap quantity"))
    );
  }

  return json(
    insertScrap.data,
    await flash(request, success("Scrap quantity recorded successfully"))
  );
}
