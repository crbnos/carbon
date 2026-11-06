// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import {
  DOCUMENT_HIDDEN_ATTRIBUTE,
  trackDocumentHidden
} from "./DocumentHidden";

let visibility: DocumentVisibilityState = "visible";
Object.defineProperty(document, "visibilityState", {
  configurable: true,
  get: () => visibility
});

const setVisibility = (next: DocumentVisibilityState) => {
  visibility = next;
  document.dispatchEvent(new Event("visibilitychange"));
};

const marked = () =>
  document.documentElement.hasAttribute(DOCUMENT_HIDDEN_ATTRIBUTE);

describe("trackDocumentHidden", () => {
  afterEach(() => {
    visibility = "visible";
  });

  it("marks <html> while the tab is hidden", () => {
    visibility = "hidden";
    const stop = trackDocumentHidden();
    expect(marked()).toBe(true);
    setVisibility("visible");
    expect(marked()).toBe(false);
    setVisibility("hidden");
    expect(marked()).toBe(true);
    stop();
    expect(marked()).toBe(false);
  });

  it("stops following visibility after cleanup", () => {
    const stop = trackDocumentHidden();
    stop();
    setVisibility("hidden");
    expect(marked()).toBe(false);
  });
});
