// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  keepOpenOnToast,
  refusesDragDismiss,
  startsSheetDrag
} from "../utils/dialog";

// A sheet as a phone renders it: grabber, header (title, a control), body.
function sheet(id: string) {
  const el = document.createElement("div");
  el.setAttribute("role", "dialog");
  el.innerHTML = `
    <div data-sheet-grabber><div id="${id}-bar"></div></div>
    <div data-bottom-sheet-header>
      <h2 id="${id}-title">Title</h2>
      <button id="${id}-copy">Copy</button>
      <div role="tablist"><span role="tab" id="${id}-tab">Lines</span></div>
    </div>
    <div><p id="${id}-body">Body</p></div>`;
  document.body.append(el);
  return el;
}
const byId = (id: string) => document.getElementById(id);

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("startsSheetDrag", () => {
  it("starts on the grabber and on the header's title", () => {
    const outer = sheet("a");
    expect(startsSheetDrag(byId("a-bar"), outer)).toBe(true);
    expect(startsSheetDrag(byId("a-title"), outer)).toBe(true);
  });

  it("leaves a control in the header to its own click", () => {
    const outer = sheet("a");
    expect(startsSheetDrag(byId("a-copy"), outer)).toBe(false);
    expect(startsSheetDrag(byId("a-tab"), outer)).toBe(false);
  });

  it("still starts when a control wraps the whole sheet", () => {
    const outer = sheet("a");
    const label = document.createElement("label");
    document.body.append(label);
    label.append(outer);
    expect(startsSheetDrag(byId("a-title"), outer)).toBe(true);
  });

  it("does not start in the body", () => {
    const outer = sheet("a");
    expect(startsSheetDrag(byId("a-body"), outer)).toBe(false);
  });

  it("drags only the sheet that was pressed, not the one it was opened from", () => {
    // React passes the inner sheet's press up to the outer sheet's handler.
    const outer = sheet("a");
    const inner = sheet("b");
    expect(startsSheetDrag(byId("b-title"), outer)).toBe(false);
    expect(startsSheetDrag(byId("b-title"), inner)).toBe(true);
  });
});

describe("keepOpenOnToast", () => {
  const outside = (target: Element, handler?: (event: Event) => void) => {
    const event = new Event("pointerdownoutside", { cancelable: true });
    target.addEventListener(event.type, keepOpenOnToast(handler));
    target.dispatchEvent(event);
    return event;
  };

  it("keeps the dialog open for a press on a toast, without asking the caller", () => {
    const toaster = document.createElement("ol");
    toaster.setAttribute("data-sonner-toaster", "");
    toaster.innerHTML = `<li><button id="close">x</button></li>`;
    document.body.append(toaster);
    const handler = vi.fn();
    expect(outside(byId("close")!, handler).defaultPrevented).toBe(true);
    expect(handler).not.toHaveBeenCalled();
  });

  it("hands any other outside press to the caller", () => {
    const page = document.createElement("button");
    document.body.append(page);
    const handler = vi.fn();
    expect(outside(page, handler).defaultPrevented).toBe(false);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe("refusesDragDismiss", () => {
  // jsdom has no PointerEvent; the handlers only pass it along.
  const release = () => new MouseEvent("pointerup") as PointerEvent;

  it("keeps a dialog open that refuses a press outside", () => {
    const panel = sheet("a");
    const refuse = (event: Event) => event.preventDefault();
    expect(refusesDragDismiss(panel, release(), [undefined, refuse])).toBe(
      true
    );
  });

  it("closes a dialog that refuses only while it holds a draft, once it does not", () => {
    const panel = sheet("a");
    let draft = true;
    const guard = (event: Event) => {
      if (draft) event.preventDefault();
    };
    expect(refusesDragDismiss(panel, release(), [guard])).toBe(true);
    draft = false;
    expect(refusesDragDismiss(panel, release(), [guard])).toBe(false);
  });

  it("closes a dialog with no outside handler", () => {
    expect(
      refusesDragDismiss(sheet("a"), release(), [undefined, undefined])
    ).toBe(false);
  });

  it("tells a handler where the drag happened, as Radix does", () => {
    const panel = sheet("a");
    let target: EventTarget | null = null;
    refusesDragDismiss(panel, release(), [(event) => (target = event.target)]);
    expect(target).toBe(panel);
  });
});
