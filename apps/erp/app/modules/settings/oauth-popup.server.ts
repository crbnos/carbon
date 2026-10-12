// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { OAuthPopupOutcome, OAuthPopupResult } from "./oauth-popup";
import { OAUTH_POPUP_MESSAGE } from "./oauth-popup";

/**
 * OAuth callback page: posts the outcome to the popup's opener and closes, or
 * goes to `fallbackUrl` when there is no opener (popup blocked, callback opened
 * directly). Only Carbon-authored values reach the page, never provider text.
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
