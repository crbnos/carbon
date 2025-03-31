import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json } from "@vercel/remix";
import { getOutsideOperationsByJobId } from "~/modules/production";


export async function loader({ request, params }: LoaderFunctionArgs) {
  const authorized = await requirePermissions(request, {
    view: "production",
  });

  const { jobId } = params;

  if (!jobId)
    return json({
      data: [],
    });

  const operations = await getOutsideOperationsByJobId(
    authorized.client,
    jobId,
    authorized.companyId
  );
  if (operations.error) {
    return json(
      operations,
      await flash(
        request,
        error(operations.error, "Failed to get outside operations")
      )
    );
  }

  return json(operations);
}
