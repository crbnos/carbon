// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

export function scrollIntoView(element: HTMLElement | undefined | null) {
  element?.scrollIntoView({
    inline: "nearest",
    block: "nearest"
  });
}

type StartViewTransition = (callback: () => void | Promise<void>) => {
  ready: Promise<void>;
  finished: Promise<void>;
};

export function startModeTransition(
  nextMode: "light" | "dark",
  persist: () => void
) {
  const html = document.documentElement;

  const apply = () => {
    html.classList.remove("light", "dark");
    html.classList.add(nextMode);
    document.body.removeAttribute("style");
    persist();
  };

  const start = (
    document as Document & { startViewTransition?: StartViewTransition }
  ).startViewTransition;

  if (!start) {
    apply();
    return;
  }

  html.classList.add("mode-transitioning");

  const transition = start.call(document, apply);
  transition.ready.then(() => {
    html.animate(
      { clipPath: ["inset(0 0 100% 0)", "inset(0)"] },
      {
        pseudoElement: "::view-transition-new(root)",
        duration: 600,
        easing: "cubic-bezier(0.16, 1, 0.3, 1)"
      }
    );
  });
  transition.finished.finally(() => {
    html.classList.remove("mode-transitioning");
  });
}
