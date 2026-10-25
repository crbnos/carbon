// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * NumberInput used to spread its rest props after `isReadOnly={isDisabled ||
 * isReadOnly}`, so an explicit `isReadOnly={false}` unlocked a disabled field.
 * Rendered with react-dom/server (the vitest env has no DOM).
 */
import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { areNumberFormatOptionsEqual, NumberInput } from "../Number";

// `disabled` also appears in Tailwind classes (`disabled:opacity-50`), so read
// the attribute form off the <input> only.
function inputLock(props: ComponentProps<typeof NumberInput>) {
  const attrs =
    renderToStaticMarkup(<NumberInput {...props} />).match(
      /<input([^>]*)>/
    )?.[1] ?? "";
  return {
    readonly: /\breadonly=""/i.test(attrs),
    disabled: /\bdisabled=""/i.test(attrs)
  };
}

describe("NumberInput", () => {
  it.each<
    [
      ComponentProps<typeof NumberInput>,
      { readonly: boolean; disabled: boolean }
    ]
  >([
    [{}, { readonly: false, disabled: false }],
    [
      { isReadOnly: false, isDisabled: false },
      { readonly: false, disabled: false }
    ],
    [{ isReadOnly: true }, { readonly: true, disabled: false }],
    [{ isDisabled: true }, { readonly: true, disabled: true }],
    [
      { isDisabled: true, isReadOnly: false },
      { readonly: true, disabled: true }
    ]
  ])("locks the input for %j as %j", (props, expected) => {
    expect(inputLock(props)).toEqual(expected);
  });

  it("selects the contents on focus and still calls the caller's onFocus", () => {
    // The vitest env has no DOM, so call the forwardRef render directly.
    const onFocus = vi.fn();
    const select = vi.fn();
    const event = { target: { select } };
    (
      NumberInput as unknown as {
        render: (
          p: Record<string, unknown>,
          ref: unknown
        ) => { props: { onFocus: (e: unknown) => void } };
      }
    )
      .render({ onFocus }, null)
      .props.onFocus(event);
    expect(select).toHaveBeenCalledTimes(1);
    expect(onFocus).toHaveBeenCalledWith(event);
  });
});

/**
 * react-aria compares `formatOptions` by reference and rewrites the in-progress
 * input text when it changes, so an inline literal at a call site destroys
 * half-typed decimals on any parent re-render. `NumberField` holds the reference
 * steady via this predicate — these tests pin the comparison, the snap-back
 * itself is only observable in a browser.
 */
describe("areNumberFormatOptionsEqual", () => {
  const options = { minimumFractionDigits: 0, maximumFractionDigits: 2 };

  it("treats distinct literals with the same values as equal", () => {
    expect(areNumberFormatOptionsEqual({ ...options }, { ...options })).toBe(
      true
    );
  });

  it("treats a changed value as not equal", () => {
    expect(
      areNumberFormatOptionsEqual(options, {
        ...options,
        maximumFractionDigits: 4
      })
    ).toBe(false);
  });

  it("treats an added key as not equal", () => {
    expect(
      areNumberFormatOptionsEqual(options, { ...options, style: "decimal" })
    ).toBe(false);
  });

  it("treats a removed key as not equal", () => {
    expect(
      areNumberFormatOptionsEqual(options, { maximumFractionDigits: 2 })
    ).toBe(false);
  });

  it("is insensitive to key order", () => {
    expect(
      areNumberFormatOptionsEqual(
        { style: "currency", currency: "USD" },
        { currency: "USD", style: "currency" }
      )
    ).toBe(true);
  });

  it("treats both undefined as equal", () => {
    expect(areNumberFormatOptionsEqual(undefined, undefined)).toBe(true);
  });

  it("treats one undefined side as not equal", () => {
    expect(areNumberFormatOptionsEqual(options, undefined)).toBe(false);
    expect(areNumberFormatOptionsEqual(undefined, options)).toBe(false);
  });
});
