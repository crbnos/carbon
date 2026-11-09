// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { isBareKeyForAnotherControl } from "../utils/keyboard";

function setup() {
  document.body.innerHTML = `
    <button id="record">Record</button>
    <button id="cancel">Cancel</button>
    <a id="link" href="/x">Link</a>
    <div id="plain"></div>
    <input id="field" type="text" />
  `;
  const get = (id: string) => document.getElementById(id)!;
  return { record: get("record"), get };
}

const key = (
  target: Element,
  init: Partial<Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey">>
) => ({
  key: "Enter",
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  ...init,
  target
});

describe("isBareKeyForAnotherControl", () => {
  it("stands down for a bare Enter or Space on another button or link", () => {
    const { record, get } = setup();
    expect(isBareKeyForAnotherControl(key(get("cancel"), {}), record)).toBe(
      true
    );
    expect(
      isBareKeyForAnotherControl(key(get("cancel"), { key: " " }), record)
    ).toBe(true);
    expect(isBareKeyForAnotherControl(key(get("link"), {}), record)).toBe(true);
  });

  it("fires when the key lands on the page, a text field or the button itself", () => {
    const { record, get } = setup();
    expect(isBareKeyForAnotherControl(key(get("plain"), {}), record)).toBe(
      false
    );
    expect(isBareKeyForAnotherControl(key(get("field"), {}), record)).toBe(
      false
    );
    expect(isBareKeyForAnotherControl(key(record, {}), record)).toBe(false);
  });

  it("lets a modified combo fire from another control", () => {
    const { record, get } = setup();
    expect(
      isBareKeyForAnotherControl(key(get("cancel"), { metaKey: true }), record)
    ).toBe(false);
    expect(
      isBareKeyForAnotherControl(key(get("cancel"), { key: "s" }), record)
    ).toBe(false);
  });
});
