// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// @vitest-environment jsdom

import type { ReactElement } from "react";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { CommandTrigger } from "../Command";
import { FormControl, FormHelperText } from "../Form/FormControl";
import { FormErrorMessage } from "../Form/FormError";
import { FormLabel } from "../Form/FormLabel";
import { Input, InputGroup } from "../Input";
import { Select, SelectTrigger, SelectValue } from "../Select";
import { Textarea } from "../Textarea";

let root: Root | undefined;
let container: HTMLDivElement | undefined;

beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  // jsdom has no matchMedia; the viewport hook reads it without a provider.
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false
  })) as typeof window.matchMedia;
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

function render(ui: ReactElement) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(ui));
  return container;
}

describe("FormLabel", () => {
  it("points at the field the caller names", () => {
    const view = render(
      <FormControl>
        <FormLabel htmlFor="partId">Part ID</FormLabel>
        <Input id="partId" />
      </FormControl>
    );
    const label = view.querySelector("label")!;
    expect(label.getAttribute("for")).toBe("partId");
    expect(label.control).toBe(view.querySelector("input"));
  });

  it("points at the FormControl's id when the caller names none", () => {
    const view = render(
      <FormControl id="partId">
        <FormLabel>Part ID</FormLabel>
        <Input id="partId" />
      </FormControl>
    );
    expect(view.querySelector("label")!.getAttribute("for")).toBe("partId");
  });
});

describe("select and combobox triggers", () => {
  it("take their name from the FormControl's label", () => {
    const view = render(
      <>
        <FormControl>
          <FormLabel htmlFor="customerId">Customer</FormLabel>
          <CommandTrigger role="combobox">Select</CommandTrigger>
        </FormControl>
        <FormControl>
          <FormLabel htmlFor="unitOfMeasureCode">Unit</FormLabel>
          <Select>
            <SelectTrigger>
              <SelectValue placeholder="Select" />
            </SelectTrigger>
          </Select>
        </FormControl>
      </>
    );
    const labels = view.querySelectorAll("label");
    const triggers = view.querySelectorAll('[role="combobox"]');
    expect(triggers).toHaveLength(2);
    expect(triggers[0]!.getAttribute("aria-labelledby")).toBe(labels[0]!.id);
    expect(triggers[1]!.getAttribute("aria-labelledby")).toBe(labels[1]!.id);
  });

  it("keep a name the caller gave them", () => {
    const view = render(
      <FormControl>
        <FormLabel>Customer</FormLabel>
        <CommandTrigger role="combobox" aria-label="Pick a customer">
          Select
        </CommandTrigger>
      </FormControl>
    );
    const trigger = view.querySelector('[role="combobox"]')!;
    expect(trigger.getAttribute("aria-label")).toBe("Pick a customer");
    expect(trigger.hasAttribute("aria-labelledby")).toBe(false);
  });

  it("are not labelled when the FormControl has no label", () => {
    const view = render(
      <FormControl>
        <CommandTrigger role="combobox">Select</CommandTrigger>
      </FormControl>
    );
    expect(
      view.querySelector('[role="combobox"]')!.hasAttribute("aria-labelledby")
    ).toBe(false);
  });
});

describe("controls take the FormControl's state", () => {
  it("an invalid field marks its input and links the error to it", () => {
    const view = render(
      <FormControl isInvalid>
        <FormLabel htmlFor="paymentTermId">Payment term</FormLabel>
        <Input id="paymentTermId" />
        <FormErrorMessage>Payment term is required</FormErrorMessage>
      </FormControl>
    );
    const input = view.querySelector("input")!;
    const error = view.querySelector('[aria-live="polite"]')!;
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toBe(error.id);
    expect(input.className).toContain("border-destructive");
  });

  it("helper text leaves the description when the error replaces it", () => {
    const field = (invalid: boolean) => (
      <FormControl isInvalid={invalid}>
        <Input id="code" />
        {invalid ? (
          <FormErrorMessage>Code is required</FormErrorMessage>
        ) : (
          <FormHelperText>Up to 10 characters</FormHelperText>
        )}
      </FormControl>
    );
    const view = render(field(false));
    const input = view.querySelector("input")!;
    const helper = [...view.querySelectorAll("div[id]")].find(
      (el) => el.textContent === "Up to 10 characters"
    )!;
    expect(input.getAttribute("aria-describedby")).toBe(helper.id);

    act(() => root!.render(field(true)));
    const error = view.querySelector('[aria-live="polite"]')!;
    expect(input.getAttribute("aria-describedby")).toBe(error.id);
  });

  it("a control the caller marks valid is not described by the error", () => {
    const view = render(
      <FormControl isInvalid>
        <Input id="code" isInvalid={false} />
        <FormErrorMessage>Code is required</FormErrorMessage>
      </FormControl>
    );
    const input = view.querySelector("input")!;
    expect(input.hasAttribute("aria-invalid")).toBe(false);
    expect(input.hasAttribute("aria-describedby")).toBe(false);
  });

  it("a valid field leaves its input alone", () => {
    const view = render(
      <FormControl>
        <FormLabel htmlFor="paymentTermId">Payment term</FormLabel>
        <Input id="paymentTermId" />
      </FormControl>
    );
    const input = view.querySelector("input")!;
    expect(input.hasAttribute("aria-invalid")).toBe(false);
    expect(input.hasAttribute("aria-describedby")).toBe(false);
    expect(input.className).not.toContain("border-destructive");
  });

  it("a required field is announced as required without the browser's own validation", () => {
    const view = render(
      <FormControl isRequired>
        <Input id="name" />
      </FormControl>
    );
    const input = view.querySelector("input")!;
    expect(input.getAttribute("aria-required")).toBe("true");
    expect(input.hasAttribute("required")).toBe(false);
  });

  it("text areas, select triggers and combobox triggers are marked invalid", () => {
    const view = render(
      <>
        <FormControl isInvalid>
          <Textarea />
        </FormControl>
        <FormControl isInvalid>
          <Select>
            <SelectTrigger>
              <SelectValue placeholder="Select" />
            </SelectTrigger>
          </Select>
        </FormControl>
        <FormControl isInvalid>
          <CommandTrigger role="combobox">Select</CommandTrigger>
        </FormControl>
      </>
    );
    const textarea = view.querySelector("textarea")!;
    const [select, combobox] = view.querySelectorAll('[role="combobox"]');
    expect(textarea.getAttribute("aria-invalid")).toBe("true");
    expect(select!.getAttribute("aria-invalid")).toBe("true");
    expect(combobox!.getAttribute("aria-invalid")).toBe("true");
    expect(combobox!.className).toContain("aria-invalid:border-destructive");
  });

  it("an input group draws the error border around its input", () => {
    const view = render(
      <FormControl isInvalid>
        <InputGroup>
          <Input id="price" />
        </InputGroup>
      </FormControl>
    );
    const group = view.querySelector("input")!.parentElement!;
    expect(group.className).toContain("border-destructive");
    expect(view.querySelector("input")!.getAttribute("aria-invalid")).toBe(
      "true"
    );
  });

  it("an input outside a FormControl follows its own isInvalid", () => {
    const view = render(<Input isInvalid />);
    expect(view.querySelector("input")!.getAttribute("aria-invalid")).toBe(
      "true"
    );
  });

  it("a select keeps the aria-required its own required prop sets", () => {
    const view = render(
      <FormControl>
        <Select required>
          <SelectTrigger>
            <SelectValue placeholder="Select" />
          </SelectTrigger>
        </Select>
      </FormControl>
    );
    expect(
      view.querySelector('[role="combobox"]')!.getAttribute("aria-required")
    ).toBe("true");
  });
});
