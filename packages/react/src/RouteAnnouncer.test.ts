// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { routeChangeAction } from "./RouteAnnouncer";

const change = (overrides: Partial<Parameters<typeof routeChangeAction>[0]>) =>
  routeChangeAction({
    previousPath: "/x/sales-orders",
    nextPath: "/x/purchase-orders",
    dialogOpen: false,
    dialogWasOpen: false,
    ...overrides
  });

describe("routeChangeAction", () => {
  it("announces a new page and moves focus to it", () => {
    expect(change({})).toEqual({ announce: true, moveFocus: true });
  });

  it("leaves a route that opens a drawer to the drawer", () => {
    expect(
      change({ nextPath: "/x/sales-orders/new", dialogOpen: true })
    ).toEqual({ announce: false, moveFocus: false });
  });

  it("does not take focus back from a drawer closing over its page", () => {
    expect(
      change({
        previousPath: "/x/sales-orders/new",
        nextPath: "/x/sales-orders",
        dialogWasOpen: true
      })
    ).toEqual({ announce: true, moveFocus: false });
  });

  it("moves focus when a dialog route leads to an unrelated page", () => {
    expect(
      change({ previousPath: "/x/sales-orders/new", dialogWasOpen: true })
    ).toEqual({ announce: true, moveFocus: true });
  });
});
