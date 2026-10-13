// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Fetcher } from "react-router";
import { describe, expect, it } from "vitest";
import { useSavedToggle } from "./useSavedToggle";

const fetcher = (
  state: Fetcher["state"],
  fields?: Record<string, string>
): Fetcher => {
  const formData = fields ? new FormData() : undefined;
  for (const [key, value] of Object.entries(fields ?? {})) {
    formData?.set(key, value);
  }
  return { state, formData } as Fetcher;
};

describe("useSavedToggle", () => {
  it("shows the saved value when nothing is being saved", () => {
    expect(useSavedToggle(fetcher("idle"), "fourEyes", true)).toBe(true);
    expect(useSavedToggle(fetcher("idle"), "fourEyes", false)).toBe(false);
  });

  it("shows the value being saved while its request is in flight", () => {
    const saving = fetcher("submitting", {
      intent: "fourEyes",
      enabled: "true"
    });
    expect(useSavedToggle(saving, "fourEyes", false)).toBe(true);
    // Still in flight while the page reloads after the action.
    const reloading = fetcher("loading", {
      intent: "fourEyes",
      enabled: "false"
    });
    expect(useSavedToggle(reloading, "fourEyes", true)).toBe(false);
  });

  it("is not moved by another switch saving through the same fetcher", () => {
    const other = fetcher("submitting", { intent: "other", enabled: "true" });
    expect(useSavedToggle(other, "fourEyes", false)).toBe(false);
  });

  it("returns to the saved value when the save has failed", () => {
    // The request is over and the setting was not changed.
    expect(useSavedToggle(fetcher("idle"), "fourEyes", false)).toBe(false);
  });
});
