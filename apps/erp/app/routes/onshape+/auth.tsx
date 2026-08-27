import { createPanelSession } from "@carbon/auth/panel-session.server";
import { requireAuthSession } from "@carbon/auth/session.server";
import { PANEL_SESSION_MESSAGE } from "@carbon/ee";
import type { LoaderFunctionArgs } from "react-router";

export const config = {
  runtime: "nodejs"
};

/**
 * Popup target for the Onshape panel's "Sign in to Carbon".
 *
 * Runs on Carbon's own origin, so the normal session cookie applies: a
 * signed-out user is sent through /login (with redirectTo back here) and lands
 * on this loader once signed in. It mints a panel session and hands the token
 * to the window that opened the popup — same origin only — then closes. The
 * token never appears in a URL.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const authSession = await requireAuthSession(request);
  const token = await createPanelSession(authSession);

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
