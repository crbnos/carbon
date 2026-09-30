import { CONTROLLED_ENVIRONMENT } from "@carbon/auth";
import { getUserScopedClient } from "@carbon/auth/client.server";
import { userHasVerifiedTotpFactor } from "@carbon/auth/mfa.server";
import { requireAuthSession } from "@carbon/auth/session.server";
import { getUserClaims } from "@carbon/auth/users.server";
import { PANEL_SESSION_MESSAGE } from "@carbon/ee";
import { createPanelSession } from "@carbon/ee/onshape/panel-session.server";
import { getLogger } from "@carbon/logger";
import { requiresItarEntityCertification } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";
import { getCompanySettings } from "~/modules/settings";
import { getItarCertificationStatus } from "~/modules/users";
import { path } from "~/utils/path";

export const config = {
  runtime: "nodejs"
};

const logger = getLogger("erp", "onshape", "panel-auth");

/**
 * Popup target for the Onshape panel's "Sign in to Carbon".
 *
 * Runs on Carbon's own origin, so the normal session cookie applies: a
 * signed-out user is sent through /login (with redirectTo back here) and lands
 * on this loader once signed in. It mints a panel session and hands the token
 * to the window that opened the popup — same origin only — then closes. The
 * token never appears in a URL.
 *
 * The panel is outside the app shell, so the shell's account gates (enforced
 * MFA enrollment, ITAR attestation) are checked here before minting.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  // Session policy first: login, the controlled-environment caps, an MFA
  // challenge. Identity comes from this cookie session alone: it is the one
  // the panel session is minted from.
  const authSession = await requireAuthSession(request);
  const { companyId, userId } = authSession;

  // Also refuses customer and supplier portal accounts.
  const claims = await getUserClaims(userId, companyId);
  if (claims.role !== "employee") {
    return page("The Onshape panel is available to employees only.", 403);
  }

  // A console device session is shared at a workstation; its operator pin-ins
  // cannot reach the panel, so every write would be stamped with the device.
  if (authSession.console) {
    return page(
      "The Onshape panel can't be used from a console session. Sign in to Carbon with your own account.",
      403
    );
  }

  const client = await getUserScopedClient(userId);
  const [companySettings, itar] = await Promise.all([
    getCompanySettings(client, companyId),
    CONTROLLED_ENVIRONMENT
      ? getItarCertificationStatus(client, companyId, userId)
      : Promise.resolve({ entityCertified: true, userCertified: true })
  ]);

  const itarBlocked =
    CONTROLLED_ENVIRONMENT &&
    ((requiresItarEntityCertification(authSession.email) &&
      !itar.entityCertified) ||
      !itar.userCertified);
  const mfaRequired =
    (CONTROLLED_ENVIRONMENT || companySettings.data?.requireMfa === true) &&
    !authSession.ssoProviderId;
  if (
    itarBlocked ||
    (mfaRequired && !(await userHasVerifiedTotpFactor(userId)))
  ) {
    return page(
      "Finish setting up your Carbon account, then sign in to the panel again.",
      403,
      { href: path.to.authenticatedRoot, label: "Open Carbon" }
    );
  }

  const token = await createPanelSession(authSession);
  if (!token) {
    logger.error("Could not store an Onshape panel session", {
      companyId,
      userId
    });
    return page("Carbon couldn't sign you in. Try again in a moment.", 503);
  }

  // Safe inside a <script>: no "</" and no JS line terminators.
  const message = JSON.stringify({ type: PANEL_SESSION_MESSAGE, token })
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="robots" content="noindex">
<title>Carbon</title>
</head>
<body style="font-family: system-ui, sans-serif; padding: 2rem; color: #333;">
<p id="status">Signing you in to the Onshape panel…</p>
<script>
(function () {
  var message = ${message};
  var opener = window.opener;
  var delivered = false;
  try {
    if (opener && !opener.closed) {
      opener.postMessage(message, window.location.origin);
      delivered = true;
    }
  } catch (_) {}
  var status = document.getElementById("status");
  if (delivered) {
    status.textContent = "Signed in. You can close this window.";
    window.close();
  } else {
    status.textContent = "Open this page from the Carbon panel in Onshape.";
  }
})();
</script>
</body>
</html>
`;

  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** A refusal the user reads in the popup. Nothing is posted to the panel. */
function page(
  message: string,
  status: number,
  link?: { href: string; label: string }
) {
  const action = link
    ? `<p><a href="${escapeHtml(link.href)}">${escapeHtml(link.label)}</a></p>`
    : "";
  return new Response(
    `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="robots" content="noindex">
<title>Carbon</title>
</head>
<body style="font-family: system-ui, sans-serif; padding: 2rem; color: #333;">
<p>${escapeHtml(message)}</p>
${action}
</body>
</html>
`,
    {
      status,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store"
      }
    }
  );
}
