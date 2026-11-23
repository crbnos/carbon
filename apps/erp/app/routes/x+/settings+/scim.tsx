// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { EntitlementError } from "@carbon/ee/entitlements.server";
import {
  createScimConnection,
  regenerateScimToken,
  saveScimGroupMappings,
  turnOffScimConnection,
  updateScimConnection
} from "@carbon/ee/scim.server";
import { validationError, validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  scimConnectionValidator,
  scimGroupMappingsValidator
} from "~/modules/settings/settings.models";
import { getDatabaseClient } from "~/services/database.server";
import { path } from "~/utils/path";

const logger = getLogger("erp", "settings-scim");

// Action-only, like `sso.tsx`: the Provisioning section lives on the Security
// screen, so a direct GET lands there.
export async function loader() {
  throw redirect(path.to.security);
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    update: "settings"
  });

  const formData = await request.formData();
  const intent = formData.get("intent");
  const serviceRole = getCarbonServiceRole();

  // `token` is the raw token, returned once to the fetcher that made it.
  const reply = async (
    result: ReturnType<typeof success>,
    body: { token?: string | null; success?: boolean } = {}
  ) => data({ token: null, ...body }, await flash(request, result));
  const refuse = (message: string, body?: { success: boolean }) =>
    reply(error(null, message), body);

  try {
    if (intent === "create" || intent === "update") {
      const validation = await validator(scimConnectionValidator).validate(
        formData
      );
      if (validation.error) return validationError(validation.error);
      const input = { ...validation.data, companyId, userId };

      if (intent === "create") {
        const created = await createScimConnection(
          serviceRole,
          getDatabaseClient(),
          input
        );
        if (!created.data) {
          return refuse(created.error ?? "Failed to set up SCIM");
        }
        return reply(success("SCIM provisioning is set up"), {
          token: created.data.token
        });
      }

      const updated = await updateScimConnection(
        serviceRole,
        getDatabaseClient(),
        input
      );
      if (updated.error) return refuse(updated.error);
      return reply(success("SCIM provisioning saved"));
    }

    if (intent === "regenerate") {
      const regenerated = await regenerateScimToken(serviceRole, {
        companyId,
        userId
      });
      if (!regenerated.data) {
        return refuse(
          regenerated.error ?? "Failed to regenerate the SCIM token"
        );
      }
      return reply(
        success("New SCIM token made. The old token no longer works."),
        { token: regenerated.data.token }
      );
    }

    if (intent === "saveGroupMappings") {
      const validation = await validator(scimGroupMappingsValidator).validate(
        formData
      );
      if (validation.error) return validationError(validation.error);

      const saved = await saveScimGroupMappings(
        serviceRole,
        getDatabaseClient(),
        { ...validation.data, companyId, userId }
      );
      if (saved.error) return refuse(saved.error, { success: false });
      return reply(success("Group mappings saved"), { success: true });
    }

    if (intent === "delete") {
      const turnedOff = await turnOffScimConnection(serviceRole, {
        companyId,
        userId
      });
      if (turnedOff.error) return refuse(turnedOff.error);
      throw redirect(
        path.to.security,
        await flash(request, success("SCIM provisioning is turned off"))
      );
    }
  } catch (err) {
    if (err instanceof EntitlementError) {
      return refuse("SCIM provisioning requires the Business plan");
    }
    if (err instanceof Response) throw err;
    logger.error("SCIM settings action failed", {
      companyId,
      intent,
      error: err
    });
    return refuse("Failed to save SCIM provisioning");
  }

  return refuse("Unknown intent");
}
