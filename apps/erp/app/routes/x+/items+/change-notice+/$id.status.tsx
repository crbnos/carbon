import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { changeNoticeStatusValidator } from "~/modules/items";
import { transitionChangeNoticeStatus } from "~/modules/items/items.server";
import { getDatabaseClient } from "~/services/database.server";
import { path, requestReferrer } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId, companyId } = await requirePermissions(request, {
    update: "parts"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const formData = await request.formData();
  const validation = await validator(changeNoticeStatusValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { fromStatus, status: toStatus, assignee } = validation.data;

  const result = await transitionChangeNoticeStatus(
    client,
    getDatabaseClient(),
    { id, companyId, userId, fromStatus, toStatus, assignee }
  );
  if (result.error) {
    throw redirect(
      requestReferrer(request) ?? path.to.changeNoticeDetails(id),
      await flash(request, error(result.cause, result.error.message))
    );
  }

  throw redirect(
    requestReferrer(request) ?? path.to.changeNoticeDetails(id),
    await flash(request, success("Updated change notice status"))
  );
}
