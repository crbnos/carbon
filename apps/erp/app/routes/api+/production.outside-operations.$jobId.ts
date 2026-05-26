import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { getOutsideOperationsByJobId } from "~/modules/production/production.service.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const _authorized = await requirePermissions(request, {
    view: "production"
  });

  const { jobId } = params;

  if (!jobId)
    return {
      data: []
    };

  const operations = await getOutsideOperationsByJobId(jobId);
  if (operations.error) {
    return data(
      operations,
      await flash(
        request,
        error(operations.error, "Failed to get outside operations")
      )
    );
  }

  return operations;
}
