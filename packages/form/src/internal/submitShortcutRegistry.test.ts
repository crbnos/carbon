import { describe, expect, it } from "vitest";
import {
  isSubmitShortcutOwner,
  registerSubmitShortcut,
  shouldSubmitOnShortcut,
  submitShortcutCount,
  unregisterSubmitShortcut
} from "./submitShortcutRegistry";

const formA = {};
const formB = {};

describe("shouldSubmitOnShortcut (guard truth table)", () => {
  it("fires when focus is inside this Submit's own form", () => {
    expect(
      shouldSubmitOnShortcut({
        ownForm: formA,
        activeForm: formA,
        activeIsEditable: true,
        activeSubmitCount: 3,
        ownsForm: true
      })
    ).toBe(true);
  });

  it("no-ops when focus is inside another form", () => {
    expect(
      shouldSubmitOnShortcut({
        ownForm: formA,
        activeForm: formB,
        activeIsEditable: true,
        activeSubmitCount: 1,
        ownsForm: true
      })
    ).toBe(false);
  });

  it("no-ops when focus is in a formless editable (agent chat textarea)", () => {
    expect(
      shouldSubmitOnShortcut({
        ownForm: formA,
        activeForm: null,
        activeIsEditable: true,
        activeSubmitCount: 1,
        ownsForm: true
      })
    ).toBe(false);
  });

  it("fires on body focus when this is the sole active Submit", () => {
    expect(
      shouldSubmitOnShortcut({
        ownForm: formA,
        activeForm: null,
        activeIsEditable: false,
        activeSubmitCount: 1,
        ownsForm: true
      })
    ).toBe(true);
  });

  it("no-ops on body focus when several Submits are active", () => {
    expect(
      shouldSubmitOnShortcut({
        ownForm: formA,
        activeForm: null,
        activeIsEditable: false,
        activeSubmitCount: 2,
        ownsForm: true
      })
    ).toBe(false);
  });

  it("never fires for a Submit detached from any form when focus is in a form", () => {
    expect(
      shouldSubmitOnShortcut({
        ownForm: null,
        activeForm: formB,
        activeIsEditable: true,
        activeSubmitCount: 1,
        ownsForm: true
      })
    ).toBe(false);
  });
});

describe("submit shortcut registry", () => {
  it("counts registrations and drops them on unregister", () => {
    const a = Symbol("a");
    const b = Symbol("b");
    const base = submitShortcutCount();
    registerSubmitShortcut(a, null);
    registerSubmitShortcut(b, null);
    expect(submitShortcutCount()).toBe(base + 2);
    unregisterSubmitShortcut(a);
    expect(submitShortcutCount()).toBe(base + 1);
    unregisterSubmitShortcut(b);
    expect(submitShortcutCount()).toBe(base);
  });
});

describe("one shortcut owner per form", () => {
  it("only the first-mounted active Submit of a form fires in-form", () => {
    const first = Symbol("first");
    const second = Symbol("second");
    const form = {} as HTMLFormElement;
    registerSubmitShortcut(first, form);
    registerSubmitShortcut(second, form);
    try {
      expect(isSubmitShortcutOwner(first, form)).toBe(true);
      expect(isSubmitShortcutOwner(second, form)).toBe(false);
      expect(
        shouldSubmitOnShortcut({
          ownForm: form,
          activeForm: form,
          activeIsEditable: true,
          activeSubmitCount: 2,
          ownsForm: isSubmitShortcutOwner(second, form)
        })
      ).toBe(false);
      expect(
        shouldSubmitOnShortcut({
          ownForm: form,
          activeForm: form,
          activeIsEditable: true,
          activeSubmitCount: 2,
          ownsForm: isSubmitShortcutOwner(first, form)
        })
      ).toBe(true);
    } finally {
      unregisterSubmitShortcut(first);
      unregisterSubmitShortcut(second);
    }
  });

  it("ownership passes to the next Submit when the owner unmounts", () => {
    const first = Symbol("first");
    const second = Symbol("second");
    const form = {} as HTMLFormElement;
    registerSubmitShortcut(first, form);
    registerSubmitShortcut(second, form);
    try {
      unregisterSubmitShortcut(first);
      expect(isSubmitShortcutOwner(second, form)).toBe(true);
    } finally {
      unregisterSubmitShortcut(first);
      unregisterSubmitShortcut(second);
    }
  });

  it("a null form never owns the shortcut", () => {
    const a = Symbol("a");
    registerSubmitShortcut(a, null);
    try {
      expect(isSubmitShortcutOwner(a, null)).toBe(false);
    } finally {
      unregisterSubmitShortcut(a);
    }
  });
});
