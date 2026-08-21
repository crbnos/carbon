import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import { ssoConnectionValidator } from "~/modules/settings";
import {
  deactivateSsoConnection,
  updateSsoRequireSso,
  upsertSsoConnection
} from "~/modules/settings/settings.server";
import { path } from "~/utils/path";

// Action-only route — the SSO admin UI lives on the Security screen. A direct
// GET (typed URL, stale bookmark) lands there instead of erroring.
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

  if (intent === "upsert") {
    const validation = await validator(ssoConnectionValidator).validate(
      formData
    );

    if (validation.error) {
      return validationError(validation.error);
    }

    const upsert = await upsertSsoConnection(getCarbonServiceRole(), {
      ...validation.data,
      companyId,
      userId
    });

    if (upsert.error) {
      return data(
        {},
        await flash(
          request,
          error(upsert.error, "Failed to save SSO connection")
        )
      );
    }

    throw redirect(
      path.to.security,
      await flash(request, success("SSO connection saved"))
    );
  }

  if (intent === "requireSso") {
    const requireSso = formData.get("enabled") === "true";
    const update = await updateSsoRequireSso(getCarbonServiceRole(), {
      companyId,
      requireSso,
      userId
    });

    if (update.error) {
      return data(
        {},
        await flash(
          request,
          error(update.error, "Failed to update SSO requirement")
        )
      );
    }

    return data(
      {},
      await flash(
        request,
        success(
          requireSso
            ? "SSO is now required for covered domains"
            : "SSO is no longer required for covered domains"
        )
      )
    );
  }

  if (intent === "deactivate") {
    const deactivate = await deactivateSsoConnection(getCarbonServiceRole(), {
      companyId,
      userId
    });

    if (deactivate.error) {
      return data(
        {},
        await flash(
          request,
          error(deactivate.error, "Failed to deactivate SSO connection")
        )
      );
    }

    throw redirect(
      path.to.security,
      await flash(request, success("SSO connection deactivated"))
    );
  }

  return data({}, await flash(request, error(null, "Unknown intent")));
}
