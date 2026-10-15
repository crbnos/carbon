// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { parseAbsolute } from "@internationalized/date";
import { describe, expect, it } from "vitest";
import {
  hasApplicationServerKey,
  isPromptSnoozed,
  nextPromptDismissal,
  PROMPT_SNOOZE_DAYS,
  parsePromptDismissal,
  restoreStep,
  urlBase64ToUint8Array
} from "./push";

describe("urlBase64ToUint8Array", () => {
  it("decodes an unpadded key", () => {
    expect([...urlBase64ToUint8Array("AQID")]).toEqual([1, 2, 3]);
  });

  it("maps the url-safe alphabet and restores the padding", () => {
    expect([...urlBase64ToUint8Array("-_8")]).toEqual([251, 255]);
  });
});

describe("browser notifications prompt", () => {
  const at = parseAbsolute("2026-10-08T10:00:00Z", "UTC");

  it("asks when it was never dismissed", () => {
    expect(isPromptSnoozed(parsePromptDismissal(null), at)).toBe(false);
  });

  it("hides for the snooze period after the first Not now", () => {
    const first = nextPromptDismissal(parsePromptDismissal(null), { at });
    expect(
      isPromptSnoozed(first, at.add({ days: PROMPT_SNOOZE_DAYS - 1 }))
    ).toBe(true);
    expect(
      isPromptSnoozed(first, at.add({ days: PROMPT_SNOOZE_DAYS + 1 }))
    ).toBe(false);
  });

  it("hides for good after the second Not now", () => {
    const first = nextPromptDismissal(parsePromptDismissal(null), { at });
    const second = nextPromptDismissal(first, { at });
    expect(isPromptSnoozed(second, at.add({ years: 2 }))).toBe(true);
  });

  it("hides for good after a Disable in settings", () => {
    const disabled = nextPromptDismissal(parsePromptDismissal(null), {
      at,
      permanently: true
    });
    expect(isPromptSnoozed(disabled, at.add({ years: 2 }))).toBe(true);
  });

  it("treats a malformed stored value as never dismissed", () => {
    expect(parsePromptDismissal("not json")).toEqual({ count: 0, until: null });
    expect(parsePromptDismissal('{"count":"x"}')).toEqual({
      count: 0,
      until: null
    });
  });
});

describe("restoreStep", () => {
  it("remembers a browser the signed-in user already owns", () => {
    expect(
      restoreStep({ ownedBySignedInUser: true, browserEnabled: false })
    ).toBe("remember");
  });

  it("saves an enabled browser for the next user to sign in", () => {
    expect(
      restoreStep({ ownedBySignedInUser: false, browserEnabled: true })
    ).toBe("save");
  });

  it("leaves a browser nobody enabled to the bell's prompt", () => {
    expect(
      restoreStep({ ownedBySignedInUser: false, browserEnabled: false })
    ).toBe("skip");
  });
});

describe("hasApplicationServerKey", () => {
  const key = (bytes: number[]) => new Uint8Array(bytes).buffer;

  it("matches a subscription made with the current key", () => {
    expect(hasApplicationServerKey(key([1, 2, 3]), "AQID")).toBe(true);
  });

  it("rejects a subscription made with another key", () => {
    expect(hasApplicationServerKey(key([1, 2, 4]), "AQID")).toBe(false);
    expect(hasApplicationServerKey(key([1, 2]), "AQID")).toBe(false);
  });

  it("rejects a subscription with no key", () => {
    expect(hasApplicationServerKey(null, "AQID")).toBe(false);
  });
});
