import { hasPermission } from "@carbon/auth";
import {
  getCompanyIdFromAPIKey,
  requirePermissions
} from "@carbon/auth/auth.server";
import { getUserClaims } from "@carbon/auth/users.server";
import type { LoaderFunctionArgs } from "react-router";
import { canViewDelayModule } from "~/modules/production/delay";
import { getDelayAnalysis } from "~/modules/production/delay.server";

const kinds = {
  job: "production",
  "sales-order": "sales",
  "purchase-order": "purchasing"
} as const;

export async function loader({ request, params }: LoaderFunctionArgs) {
  const kind = params.type;
  if (kind !== "job" && kind !== "sales-order" && kind !== "purchase-order") {
    throw new Response("Not found", { status: 404 });
  }
  if (!params.id) throw new Response("Not found", { status: 404 });

  const { client, companyId, userId } = await requirePermissions(request, {
    view: kinds[kind],
    bypassRls: true
  });
  const claims = await getUserClaims(userId, companyId);
  const apiKey = request.headers.get("carbon-key");
  const keyScopes = apiKey
    ? ((await getCompanyIdFromAPIKey(apiKey)).data?.scopes ?? {})
    : null;
  try {
    return await getDelayAnalysis(
      client,
      companyId,
      kind,
      params.id,
      (module) =>
        canViewDelayModule(
          hasPermission(claims.permissions, module, "view", companyId),
          keyScopes,
          module,
          companyId
        )
    );
  } catch {
    return null;
  }
}
