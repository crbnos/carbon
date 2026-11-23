// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// @vitest-environment jsdom

import { getEntry } from "@carbon/content/glossary";
import type { ReactElement, ReactNode } from "react";
import { act, useEffect } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { CommandTrigger } from "../Command";
import DatePicker from "../Date/DatePicker";
import TimePicker from "../Date/TimePicker";
import {
  FormControl,
  FormHelperText,
  useOptionalFormControlContext
} from "../Form/FormControl";
import { FormErrorMessage } from "../Form/FormError";
import { FormLabel } from "../Form/FormLabel";
import { Input, InputGroup } from "../Input";
import { LabelWithHelp } from "../LabelWithHelp";
import { OperatingSystemContextProvider } from "../OperatingSystem";
import { RadioGroup, RadioGroupItem } from "../Radio";
import { Select, SelectTrigger, SelectValue } from "../Select";
import { Switch } from "../Switch";
import { Textarea } from "../Textarea";

// The glossary's `msg` descriptors and the Lingui macros are compiled by the
// app build, not by vitest: stand in a plain entry and plain strings.
vi.mock("@carbon/content/glossary", () => ({
  getEntry: () => ({
    term: "Method type",
    definition: "How an item is sourced when added to a method or BOM line."
  })
}));
vi.mock("@lingui/react/macro", () => ({
  Trans: ({ children }: { children: ReactNode }) => children,
  useLingui: () => ({
    t: (strings: TemplateStringsArray, ...values: unknown[]) =>
      String.raw({ raw: strings }, ...values),
    i18n: { _: (message: unknown) => String(message) }
  })
}));

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

  it("outside a FormControl are named by the text they show", () => {
    const view = render(
      <>
        <CommandTrigger role="combobox">All customers</CommandTrigger>
        <CommandTrigger role="combobox" aria-label="Pick a customer">
          All customers
        </CommandTrigger>
      </>
    );
    const [unnamed, named] = view.querySelectorAll('[role="combobox"]');
    expect(unnamed!.getAttribute("aria-label")).toBe("All customers");
    expect(named!.getAttribute("aria-label")).toBe("Pick a customer");
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

describe("the label as text", () => {
  // An inline field's icon-only trigger names itself after this ("Edit
  // Customer"), so it must be the label alone, without the help text.
  function LabelText() {
    return <output>{useOptionalFormControlContext()?.labelText ?? ""}</output>;
  }

  it("is the label's words, not its help text", () => {
    function Help({ children }: { children: string }) {
      return (
        <span>
          {children}
          <span className="sr-only">Who the order is for.</span>
        </span>
      );
    }
    const view = render(
      <FormControl>
        <FormLabel>
          <Help>Customer</Help>
        </FormLabel>
        <LabelText />
      </FormControl>
    );
    expect(view.querySelector("output")!.textContent).toBe("Customer");
  });

  it("is the rendered text of a child that holds it outside its props", () => {
    // Lingui compiles <Trans>Customer</Trans> to an element with no children.
    function Translated() {
      return <>Customer</>;
    }
    const view = render(
      <FormControl>
        <FormLabel>
          <Translated />
        </FormLabel>
        <LabelText />
      </FormControl>
    );
    expect(view.querySelector("output")!.textContent).toBe("Customer");
  });

  it("is cleared when the label goes away", () => {
    const view = render(
      <FormControl>
        <FormLabel>Customer</FormLabel>
        <LabelText />
      </FormControl>
    );
    act(() =>
      root!.render(
        <FormControl>
          <LabelText />
        </FormControl>
      )
    );
    expect(view.querySelector("output")!.textContent).toBe("");
  });
});

describe("a glossary definition on the label", () => {
  // Stands in for LabelWithHelp, which registers its definition this way.
  function Definition({ children }: { children: string }) {
    const field = useOptionalFormControlContext()!;
    const { registerDefinition } = field;
    useEffect(() => registerDefinition(), [registerDefinition]);
    return (
      <span id={field.definitionId} aria-hidden>
        {children}
      </span>
    );
  }

  it("describes the control instead of naming it", () => {
    const view = render(
      <FormControl>
        <FormLabel htmlFor="deadlineType">
          Deadline Type
          <Definition>How the job ranks for capacity.</Definition>
        </FormLabel>
        <Input id="deadlineType" />
      </FormControl>
    );
    const definition = view.querySelector("span[aria-hidden]")!;
    expect(view.querySelector("input")!.getAttribute("aria-describedby")).toBe(
      definition.id
    );
  });

  it("leaves the description when the definition goes away", () => {
    const view = render(
      <FormControl>
        <FormLabel htmlFor="deadlineType">
          Deadline Type
          <Definition>How the job ranks for capacity.</Definition>
        </FormLabel>
        <Input id="deadlineType" />
      </FormControl>
    );
    act(() =>
      root!.render(
        <FormControl>
          <FormLabel htmlFor="deadlineType">Deadline Type</FormLabel>
          <Input id="deadlineType" />
        </FormControl>
      )
    );
    expect(view.querySelector("input")!.hasAttribute("aria-describedby")).toBe(
      false
    );
  });
});

describe("a LabelWithHelp definition", () => {
  const definition = String(getEntry("method-type").definition);

  /** The text of the elements the control's aria-describedby names. */
  function description(control: Element) {
    return (control.getAttribute("aria-describedby") ?? "")
      .split(" ")
      .filter(Boolean)
      .map((id) => document.getElementById(id)?.textContent)
      .join(" ");
  }

  function field(control: ReactNode) {
    return (
      <FormControl>
        <FormLabel htmlFor="methodType">
          <LabelWithHelp termId="method-type">Method Type</LabelWithHelp>
        </FormLabel>
        {control}
      </FormControl>
    );
  }

  it("describes an input and leaves its name", () => {
    const view = render(field(<Input id="methodType" />));
    const input = view.querySelector("input")!;
    expect(description(input)).toBe(definition);
    // The copy in the label is hidden, so the name stays "Method Type".
    const copy = document.getElementById(
      input.getAttribute("aria-describedby")!
    );
    expect(copy!.getAttribute("aria-hidden")).toBe("true");
  });

  it("describes a radio group", () => {
    const view = render(
      field(
        <RadioGroup aria-label="Method Type">
          <RadioGroupItem value="Make" aria-label="Make" />
        </RadioGroup>
      )
    );
    expect(description(view.querySelector('[role="radiogroup"]')!)).toBe(
      definition
    );
  });

  it("describes a switch", () => {
    const view = render(field(<Switch aria-label="Method Type" />));
    expect(description(view.querySelector('[role="switch"]')!)).toBe(
      definition
    );
  });

  it("describes a time field and a date field", () => {
    for (const control of [
      <TimePicker key="time" aria-label="Start time" />,
      <DatePicker key="date" aria-label="Due date" />
    ]) {
      // The date picker's buttons read the platform for their shortcuts.
      const view = render(
        <OperatingSystemContextProvider platform="mac">
          {field(control)}
        </OperatingSystemContextProvider>
      );
      // A screen reader reads the description on the first segment.
      expect(description(view.querySelector('[role="spinbutton"]')!)).toBe(
        definition
      );
      act(() => root!.unmount());
      view.remove();
    }
  });

  it("describes a control the caller already describes, after its own", () => {
    const view = render(
      <>
        <p id="note">Set by the item.</p>
        {field(<Switch aria-label="Method Type" aria-describedby="note" />)}
      </>
    );
    expect(description(view.querySelector('[role="switch"]')!)).toBe(
      `Set by the item. ${definition}`
    );
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
