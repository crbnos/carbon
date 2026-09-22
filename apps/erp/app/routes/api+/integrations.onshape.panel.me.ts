import type { OnshapePanelMe } from "@carbon/ee";
import { requireOnshapePanelPermissions } from "@carbon/ee/onshape/panel-session.server";
import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";

export const config = {
  runtime: "nodejs"
};

/** Who the panel's bearer token belongs to. 401 when it is missing or dead. */
export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, userId, email } =
    await requireOnshapePanelPermissions(request, {});

  const company = await client
    .from("company")
    .select("id, name")
    .eq("id", companyId)
    .maybeSingle();

  const me: OnshapePanelMe = {
    userId,
    email,
    company: company.data
      ? { id: company.data.id, name: company.data.name }
      : null
  };

  return data(me, { headers: { "Cache-Control": "no-store" } });
}
