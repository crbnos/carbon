import type { OAuthPopupOutcome, OAuthPopupResult } from "./oauth-popup";
import { OAUTH_POPUP_MESSAGE } from "./oauth-popup";

/**
 * The page an OAuth callback renders when the provider redirects the user's
 * browser back to Carbon.
 *
 * The authorize URL is opened in a popup (`openOAuthPopup` in @carbon/ee), so
 * the callback runs inside that popup. Redirecting it to the integrations page
 * left the whole settings UI open in a 600×800 window and the page behind it
 * unaware anything happened. Instead, post the result to the window that
 * opened the popup and close; `IntegrationCard` turns it into a revalidation
 * (success) or a toast (failure).
 *
 * `fallbackUrl` covers the no-opener cases — popups blocked (the install hook
 * navigated the current window instead) or the callback opened directly. It is
 * the integrations page, with the error query string on failure, i.e. exactly
 * where the callback redirected before.
 *
 * Only Carbon-authored values reach the page: the integration id and an error
 * code from `integration-errors`, never provider text.
 */
export function oauthPopupResponse(
  outcome: OAuthPopupOutcome,
  fallbackUrl: string
) {
  const message: OAuthPopupResult = { type: OAUTH_POPUP_MESSAGE, ...outcome };

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="robots" content="noindex">
<title>Carbon</title>
</head>
<body>
<script>
(function () {
  var message = ${embed(message)};
  var fallback = ${embed(fallbackUrl)};
  var opener = window.opener;
  var delivered = false;
  try {
    if (opener && !opener.closed) {
      opener.postMessage(message, window.location.origin);
      delivered = true;
    }
  } catch (_) {}
  if (delivered) {
    window.close();
  }
  // Still here: no opener, or the browser refused to close the window. Land
  // where a plain redirect would have.
  window.setTimeout(function () {
    window.location.replace(fallback);
  }, delivered ? 500 : 0);
})();
</script>
<noscript><a href="${escapeAttribute(fallbackUrl)}">Continue</a></noscript>
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

/** JSON that is safe inside a <script> element. */
function embed(value: unknown) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function escapeAttribute(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
