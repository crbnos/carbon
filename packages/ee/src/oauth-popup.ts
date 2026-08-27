/**
 * Opens a provider's authorize URL in a centered popup. If the browser blocks
 * popups, navigates the current window instead.
 *
 * The provider redirects the popup back to Carbon's OAuth callback, which posts
 * its outcome to `window.opener` and closes the popup (the ERP's
 * `modules/settings/oauth-popup.server.ts`); the integrations page listens for
 * the message and revalidates. With no opener — popups blocked, so the current
 * window was navigated — the callback falls back to a plain redirect to the
 * integrations page.
 *
 * Runs in the browser only.
 */
export function openOAuthPopup(url: string) {
  const width = 600;
  const height = 800;
  const left = window.screenX + (window.outerWidth - width) / 2;
  const top = window.screenY + (window.outerHeight - height) / 2.5;

  const popup = window.open(
    url,
    "",
    `toolbar=no, location=no, directories=no, status=no, menubar=no, scrollbars=no, resizable=no, copyhistory=no, width=${width}, height=${height}, top=${top}, left=${left}`
  );

  if (!popup) {
    window.location.href = url;
  }
}
