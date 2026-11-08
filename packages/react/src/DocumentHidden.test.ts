// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// @vitest-environment jsdom

import { act, createElement } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import {
  closedLayerMotionCss,
  DOCUMENT_HIDDEN_ATTRIBUTE,
  DocumentHiddenMotion,
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

describe("DocumentHiddenMotion", () => {
  // A mismatch at the root makes React rebuild the whole document, stylesheet
  // links included: the page flashes unstyled on every load.
  it("hydrates the server's markup without a mismatch", async () => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement("div");
    container.innerHTML = renderToString(createElement(DocumentHiddenMotion));
    // The server writes the CSS as it is: no &quot; in place of the quotes.
    expect(container.querySelector("style")?.textContent).toBe(
      closedLayerMotionCss
    );
    const errors: unknown[] = [];
    await act(async () => {
      hydrateRoot(container, createElement(DocumentHiddenMotion), {
        onRecoverableError: (error) => errors.push(error)
      });
    });
    expect(errors).toEqual([]);
  });
});
