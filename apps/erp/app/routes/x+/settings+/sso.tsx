import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import {
  addSsoDomain,
  deactivateSsoConnection,
  isSsoEnabled,
  removeSsoDomain,
  updateSsoRequireSso,
  upsertSsoConnection,
  verifySsoDomain
} from "@carbon/ee/sso.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import { ssoConnectionValidator, ssoDomainValidator } from "~/modules/settings";
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

  // Defense in depth on top of the ee module's self-gating: a non-Enterprise
  // deployment (or one without `sso` in AUTH_PROVIDERS) refuses the whole
  // action even if a client posts to it directly.
  if (!isSsoEnabled()) {
    throw redirect(
      path.to.security,
      await flash(
        request,
        error(null, "Single sign-on requires Carbon Enterprise edition")
      )
    );
  }

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
          error(upsert.error, "Failed to save SAML SSO connection")
        )
      );
    }

    throw redirect(
      path.to.security,
      await flash(request, success("SAML SSO connection saved"))
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
          error(update.error, "Failed to update SAML SSO requirement")
        )
      );
    }

    return data(
      {},
      await flash(
        request,
        success(
          requireSso
            ? "SAML SSO is now required for covered domains"
            : "SAML SSO is no longer required for covered domains"
        )
      )
    );
  }

  if (intent === "addDomain") {
    const validation = await validator(ssoDomainValidator).validate(formData);

    if (validation.error) {
      return validationError(validation.error);
    }

    const insert = await addSsoDomain(getCarbonServiceRole(), {
      companyId,
      domain: validation.data.domain,
      userId
    });

    if (insert.error) {
      // Flash shows only the message argument — surface the service's strings.
      return data({}, await flash(request, error(insert.error, insert.error)));
    }

    return data(
      {},
      await flash(
        request,
        success(
          "Domain added. Publish the TXT record shown below, then click Verify."
        )
      )
    );
  }

  if (intent === "verifyDomain") {
    const domainId = formData.get("domainId");
    if (typeof domainId !== "string" || !domainId) {
      return data({}, await flash(request, error(null, "Unknown domain")));
    }

    const result = await verifySsoDomain(getCarbonServiceRole(), {
      companyId,
      domainId,
      userId
    });

    if (result.error) {
      return data({}, await flash(request, error(result.error, result.error)));
    }

    if (result.data?.verified) {
      return data(
        {},
        await flash(
          request,
          success("Domain verified — it can now route SAML SSO sign-ins")
        )
      );
    }

    // Reason-specific copy: the difference between "not there yet" and "wrong
    // token" is exactly what the admin needs to fix their DNS record.
    const message =
      result.data?.reason === "token_mismatch"
        ? "A TXT record exists but its value does not match this company's verification token. Check that the record's value was copied exactly."
        : result.data?.reason === "dns_error"
          ? "The DNS lookup failed. Check your network's outbound DNS access and try again."
          : "No TXT record found yet. DNS changes can take a few minutes to propagate — check the record's host name and try again shortly.";
    return data({}, await flash(request, error(null, message)));
  }

  if (intent === "removeDomain") {
    const domainId = formData.get("domainId");
    if (typeof domainId !== "string" || !domainId) {
      return data({}, await flash(request, error(null, "Unknown domain")));
    }

    const removal = await removeSsoDomain(getCarbonServiceRole(), {
      companyId,
      domainId
    });

    if (removal.error) {
      return data(
        {},
        await flash(request, error(removal.error, "Failed to remove domain"))
      );
    }

    return data({}, await flash(request, success("Domain removed")));
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
          error(deactivate.error, "Failed to deactivate SAML SSO connection")
        )
      );
    }

    throw redirect(
      path.to.security,
      await flash(request, success("SAML SSO connection deactivated"))
    );
  }

  return data({}, await flash(request, error(null, "Unknown intent")));
}
