/**
 * Tests for NumberInput — ensures the prop-spreading bug is fixed so that
 * isReadOnly and isDisabled are not overridden by the rest-props spread.
 *
 * Uses react-dom/server renderToStaticMarkup (no DOM / jsdom required) to
 * assert the rendered HTML attributes.
 *
 * Note: `disabled` also appears in Tailwind class names like `disabled:opacity-50`.
 * We check for the HTML attribute form `disabled=""` to avoid false positives.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { NumberInput } from "../Number";

/**
 * The `onFocus` behavior ([4] focus-select) is an inline closure on the real
 * NumberInput. The vitest env is `node` (no jsdom), so we exercise the actual
 * component's render output via forwardRef's `.render` — no reimplementation —
 * and invoke the handler it wires onto the underlying Input with a stub event.
 */
type FocusableElement = { props: { onFocus?: (e: unknown) => void } };
function getRenderedOnFocus(props: Record<string, unknown>) {
  // forwardRef components expose the render fn; call it to get the element tree.
  const rendered = (
    NumberInput as unknown as {
      render: (p: Record<string, unknown>, ref: unknown) => FocusableElement;
    }
  ).render(props, null);
  return rendered.props.onFocus;
}

/** Returns the first <input> element's attribute string from rendered HTML */
function getInputAttrs(html: string): string {
  const match = html.match(/<input([^>]*)>/);
  return match?.[1] ?? "";
}

describe("NumberInput", () => {
  it("has no readonly attribute by default (allows typing for non-serial items)", () => {
    const attrs = getInputAttrs(renderToStaticMarkup(<NumberInput />));
    // HTML readonly attr is rendered as readonly="" by React
    expect(attrs).not.toMatch(/\breadonly=""/i);
  });

  it("has no readonly attribute when isReadOnly=false and isDisabled=false", () => {
    // Key regression guard: before the fix, {…props} spread would re-introduce
    // isReadOnly=false AFTER the explicit isReadOnly={isDisabled || isReadOnly},
    // but this case (both false) was unaffected — confirms the happy path still works.
    const attrs = getInputAttrs(
      renderToStaticMarkup(
        <NumberInput isReadOnly={false} isDisabled={false} />
      )
    );
    expect(attrs).not.toMatch(/\breadonly=""/i);
    expect(attrs).not.toMatch(/\bdisabled=""/i);
  });

  it("has readonly attribute when isReadOnly=true (serial-tracked lock preserved)", () => {
    const attrs = getInputAttrs(
      renderToStaticMarkup(<NumberInput isReadOnly />)
    );
    expect(attrs).toMatch(/\breadonly=""/i);
  });

  it("has disabled attribute when isDisabled=true", () => {
    const attrs = getInputAttrs(
      renderToStaticMarkup(<NumberInput isDisabled />)
    );
    expect(attrs).toMatch(/\bdisabled=""/i);
  });

  it("has disabled attribute when isDisabled=true even if isReadOnly=false (regression guard)", () => {
    // Before the fix: {…props} spread would override isReadOnly={true || false}
    // with isReadOnly=false — this test would have caught that bug.
    const attrs = getInputAttrs(
      renderToStaticMarkup(<NumberInput isDisabled={true} isReadOnly={false} />)
    );
    // A disabled input carries disabled="" — not editable regardless
    expect(attrs).toMatch(/\bdisabled=""/i);
  });

  describe("focus behavior ([4] field selects on focus for quick overwrite)", () => {
    it("selects the input's contents on focus", () => {
      const select = vi.fn();
      getRenderedOnFocus({})?.({ target: { select } });
      expect(select).toHaveBeenCalledTimes(1);
    });

    it("forwards the focus event to a caller-supplied onFocus (tab/focus unbroken)", () => {
      const onFocus = vi.fn();
      const select = vi.fn();
      const event = { target: { select } };
      getRenderedOnFocus({ onFocus })?.(event);
      expect(select).toHaveBeenCalledTimes(1);
      expect(onFocus).toHaveBeenCalledTimes(1);
      expect(onFocus).toHaveBeenCalledWith(event);
    });

    it("does not throw when no onFocus is provided", () => {
      expect(() =>
        getRenderedOnFocus({})?.({ target: { select: vi.fn() } })
      ).not.toThrow();
    });
  });
});
