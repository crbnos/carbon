import { getCarbonServiceRole } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json } from "@vercel/remix";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { companyId } = await requirePermissions(request, {});

  const serviceRole = getCarbonServiceRole();

  if (!params.version) {
    return json(
      { success: false, error: "Version is required" },
      { status: 400 }
    );
  }

  if (params.version === "v1") {
    const result = await serviceRole.rpc("radan_v1", {
      company_id: companyId,
    });

    if (result.error) {
      return json(
        { success: false, error: result.error.message },
        { status: 500 }
      );
    }

    return json({ success: true, data: result.data });
  }

  return json({
    success: false,
    error: `version ${params.version} is invalid`,
  });
}
