import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import {
  disconnectConnection,
  renameConnection
} from "@carbon/ee/integrations/connections";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";

export const config = {
  runtime: "nodejs"
};

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "settings"
  });

  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");
  const id = String(formData.get("id") ?? "");

  if (!id) {
    return data(
      { success: false },
      await flash(request, error(null, "No connection was named"))
    );
  }

  if (intent === "rename") {
    const name = String(formData.get("name") ?? "").trim();
    if (!name) {
      return data(
        { success: false },
        await flash(request, error(null, "A connection needs a name"))
      );
    }
    const update = await renameConnection(client, companyId, id, name, userId);
    if (update.error) {
      return data(
        { success: false },
        await flash(request, error(update.error, "Failed to rename connection"))
      );
    }
    return data({ success: true }, await flash(request, success("Renamed")));
  }

  if (intent === "disconnect") {
    try {
      // Dropping the vaulted token needs the service role; the row is scoped by
      // the companyId this request already authorized.
      await disconnectConnection(getCarbonServiceRole(), companyId, id, userId);
    } catch (err) {
      return data(
        { success: false },
        await flash(request, error(err, "Failed to disconnect"))
      );
    }
    return data(
      { success: true },
      await flash(request, success("Disconnected"))
    );
  }

  return data(
    { success: false },
    await flash(request, error(null, "Unknown action"))
  );
}
