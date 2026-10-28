// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Watches for a toast of one type appearing (sonner 2: each toast is an
// `li[data-sonner-toast][data-type]` inside an `ol[data-sonner-toaster]`,
// and the list itself is only mounted while it holds a toast). The observer
// covers the whole page, so every other change is turned away by one
// `matches` on the record's target or on what was added to it.

const TOASTER = "[data-sonner-toaster]";

export function onToast(
  type: "success" | "error",
  callback: (toast: Element) => void
) {
  const selector = `[data-sonner-toast][data-type="${type}"]`;
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      const inToaster =
        record.target instanceof Element && record.target.matches(TOASTER);
      for (const node of Array.from(record.addedNodes)) {
        if (!(node instanceof Element)) continue;
        // A toast added to a list already showing, or a new list with it.
        const toast = inToaster
          ? node.matches(selector)
            ? node
            : null
          : node.matches(TOASTER)
            ? node.querySelector(selector)
            : null;
        if (toast) callback(toast);
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  return () => observer.disconnect();
}
