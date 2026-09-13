import { hasPermission } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getUserClaims } from "@carbon/auth/users.server";
import type { OnshapePanelMe } from "@carbon/ee";
import { parsePushDefaults } from "@carbon/ee";
import { ONSHAPE_V2_INTEGRATION_ID } from "@carbon/ee/onshape";
import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";

export const config = {
  runtime: "nodejs"
};

/** Who the panel's bearer token belongs to. 401 when it is missing or dead. */
export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, userId, email, sessionUserId } =
    await requirePermissions(request, {});

  const [company, integration, units, claims] = await Promise.all([
    client.from("company").select("id, name").eq("id", companyId).maybeSingle(),
    client
      .from("companyIntegration")
      .select("metadata")
      .eq("id", ONSHAPE_V2_INTEGRATION_ID)
      .eq("companyId", companyId)
      .maybeSingle(),
    client
      .from("unitOfMeasure")
      .select("code, name")
      .eq("companyId", companyId)
      .order("name"),
    // `requirePermissions` cannot be probed twice without side effects, so the
    // claims check runs directly — the same pair the fields route uses for its
    // own `canEdit`. Claims belong to the session user (`userId` may be a
    // console-mode effective user), matching what the writes enforce.
    getUserClaims(sessionUserId, companyId)
  ]);

  // The company's push preferences and its unit list ride along with identity
  // because they are per-company, not per-element: fetching them here costs one
  // read a session rather than one on every element the user opens.
  const me: OnshapePanelMe = {
    userId,
    email,
    company: company.data
      ? { id: company.data.id, name: company.data.name }
      : null,
    pushDefaults: parsePushDefaults(integration.data?.metadata),
    unitsOfMeasure: (units.data ?? []).map((unit) => ({
      code: unit.code,
      name: unit.name
    })),
    // One gate for the whole Settings page: it saves the push defaults and the
    // property map under a single button, and both writes require the same
    // permission. It arrives with identity so the page knows before the
    // property map loads — and on an element that has no properties to load.
    canEditSettings: hasPermission(
      claims?.permissions,
      "settings",
      "update",
      companyId
    )
  };

  return data(me, { headers: { "Cache-Control": "no-store" } });
}
