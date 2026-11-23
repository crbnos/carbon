// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import * as cookie from "cookie";

/**
 * Whether the person shows the module menu on the full-width board pages
 * (`handle.boardSidebar`). One choice for every board, per browser; no cookie
 * means hidden.
 */
export const BOARD_SIDEBAR_COOKIE = "boardSidebar";

const BOARD_SIDEBAR_MAX_AGE = 31536000;

export function isBoardSidebarShown(cookieHeader: string | null | undefined) {
  if (!cookieHeader) return false;
  return cookie.parse(cookieHeader)[BOARD_SIDEBAR_COOKIE] === "shown";
}

/** The `document.cookie` string that stores the choice; hiding clears it. */
export function boardSidebarCookie(shown: boolean) {
  return cookie.serialize(BOARD_SIDEBAR_COOKIE, shown ? "shown" : "", {
    path: "/",
    sameSite: "lax",
    maxAge: shown ? BOARD_SIDEBAR_MAX_AGE : 0
  });
}

type SidebarHandle<T> = {
  sidebar?: T;
  boardSidebar?: T;
  compactSidebar?: T;
  hideModuleSidebar?: boolean;
};

/**
 * The module sidebar the route handles declare: `desktop` for the docked
 * sidebar, `compact` for the phone section switcher, and `isBoard` when the
 * route is a board whose desktop sidebar the person shows or hides.
 */
export function resolveModuleSidebar<T>(
  handles: (SidebarHandle<T> | undefined)[],
  boardSidebarShown: boolean
) {
  const hidden = handles.some((handle) => handle?.hideModuleSidebar);
  const sidebar = hidden
    ? undefined
    : handles.find((handle) => handle?.sidebar)?.sidebar;
  const board =
    hidden || sidebar
      ? undefined
      : handles.find((handle) => handle?.boardSidebar)?.boardSidebar;

  return {
    desktop: sidebar ?? (boardSidebarShown ? board : undefined),
    compact:
      sidebar ??
      board ??
      handles.find((handle) => handle?.compactSidebar)?.compactSidebar,
    isBoard: Boolean(board)
  };
}
