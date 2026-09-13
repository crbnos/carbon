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

/**
 * A popup opened during the click itself, navigated once the authorize URL
 * arrives.
 *
 * `window.open` is only honoured while the browser holds transient user
 * activation — roughly five seconds from the click. An install handler that
 * awaits a fetch first can outlive that (a cold dev route compiling is enough),
 * and Chrome then blocks the popup while still handing back a window object,
 * so a `if (!popup)` fallback never fires and the click looks like it did
 * nothing at all. Opening synchronously and setting `location` afterwards keeps
 * the popup inside the gesture, however slow the fetch is.
 */
export type OAuthPopupHandle = {
  /** Send the popup to the provider, or the current window if it was blocked. */
  navigate: (url: string) => void;
  /** Give up: close the popup so a failure does not leave a blank window. */
  close: () => void;
};

export function beginOAuthPopup(): OAuthPopupHandle {
  const width = 600;
  const height = 800;
  const left = window.screenX + (window.outerWidth - width) / 2;
  const top = window.screenY + (window.outerHeight - height) / 2.5;

  const popup = window.open(
    "",
    "",
    `toolbar=no, location=no, directories=no, status=no, menubar=no, scrollbars=no, resizable=no, copyhistory=no, width=${width}, height=${height}, top=${top}, left=${left}`
  );

  return {
    navigate(url: string) {
      if (popup && !popup.closed) {
        popup.location.href = url;
        popup.focus();
      } else {
        // Blocked, or the user closed it while we were fetching. The callback
        // falls back to a plain redirect when it has no opener.
        window.location.href = url;
      }
    },
    close() {
      if (popup && !popup.closed) popup.close();
    }
  };
}
