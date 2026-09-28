import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import type { JobOperation } from "~/modules/production";
import { setJobOperationStatus } from "~/modules/production/production.server";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "production"
  });

  const formData = await request.formData();
  const id = formData.get("id") as string;
  const status = formData.get("status") as JobOperation["status"];

  const result = await setJobOperationStatus(client, {
    id,
    companyId,
    userId,
    status
  });
  if (result.error) {
    return data(
      {},
      await flash(request, error(result.cause, result.error.message))
    );
  }

  return {};
}
