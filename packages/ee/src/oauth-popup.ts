// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

/**
 * Browser only. Opens the popup synchronously inside the click and navigates it
 * once the authorize URL arrives: `window.open` after an awaited fetch can
 * outlive transient user activation, and Chrome then blocks it silently.
 */
export type OAuthPopupHandle = {
  /** Falls back to the current window when the popup was blocked. */
  navigate: (url: string) => void;
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
        // With no opener, the callback redirects to the integrations page.
        window.location.href = url;
      }
    },
    close() {
      if (popup && !popup.closed) popup.close();
    }
  };
}
