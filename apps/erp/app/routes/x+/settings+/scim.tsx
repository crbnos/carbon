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

// Action-only route — the Provisioning section lives on the Security screen,
// beside SAML SSO (the sibling `sso.tsx`). A direct GET lands there instead.
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

  try {
    if (intent === "create" || intent === "update") {
      const validation = await validator(scimConnectionValidator).validate(
        formData
      );
      if (validation.error) return validationError(validation.error);

      if (intent === "create") {
        const created = await createScimConnection(
          serviceRole,
          getDatabaseClient(),
          { ...validation.data, companyId, userId }
        );
        if (created.error || !created.data) {
          return data(
            { token: null },
            await flash(
              request,
              error(created.error, created.error ?? "Failed to set up SCIM")
            )
          );
        }
        // The raw token goes back once, to the fetcher that made it.
        return data(
          { token: created.data.token },
          await flash(request, success("SCIM provisioning is set up"))
        );
      }

      const updated = await updateScimConnection(
        serviceRole,
        getDatabaseClient(),
        { ...validation.data, companyId, userId }
      );
      if (updated.error) {
        return data(
          { token: null },
          await flash(request, error(updated.error, updated.error))
        );
      }
      return data(
        { token: null },
        await flash(request, success("SCIM provisioning saved"))
      );
    }

    if (intent === "regenerate") {
      const regenerated = await regenerateScimToken(serviceRole, {
        companyId,
        userId
      });
      if (regenerated.error || !regenerated.data) {
        return data(
          { token: null },
          await flash(
            request,
            error(
              regenerated.error,
              regenerated.error ?? "Failed to regenerate the SCIM token"
            )
          )
        );
      }
      return data(
        { token: regenerated.data.token },
        await flash(
          request,
          success("New SCIM token made. The old token no longer works.")
        )
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
      if (saved.error) {
        return data(
          { token: null, success: false },
          await flash(request, error(saved.error, saved.error))
        );
      }
      return data(
        { token: null, success: true },
        await flash(request, success("Group mappings saved"))
      );
    }

    if (intent === "delete") {
      const turnedOff = await turnOffScimConnection(serviceRole, {
        companyId,
        userId
      });
      if (turnedOff.error) {
        return data(
          { token: null },
          await flash(request, error(turnedOff.error, turnedOff.error))
        );
      }
      throw redirect(
        path.to.security,
        await flash(request, success("SCIM provisioning is turned off"))
      );
    }
  } catch (err) {
    if (err instanceof EntitlementError) {
      return data(
        { token: null },
        await flash(
          request,
          error(null, "SCIM provisioning requires the Business plan")
        )
      );
    }
    if (err instanceof Response) throw err;
    logger.error("SCIM settings action failed", {
      companyId,
      intent,
      error: err
    });
    return data(
      { token: null },
      await flash(request, error(null, "Failed to save SCIM provisioning"))
    );
  }

  return data(
    { token: null },
    await flash(request, error(null, "Unknown intent"))
  );
}
