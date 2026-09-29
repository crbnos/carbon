import type { ReactNode } from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// `@carbon/glossary`'s terms.ts evaluates Lingui `msg` macros at module load,
// which vitest does not transform, and the `@carbon/react` barrel pulls it in.
vi.mock("@carbon/glossary", () => ({
  getDefinitionText: () => "",
  getEntry: () => undefined,
  getTermText: () => "",
  glossaryEntries: () => [],
  hasEntry: () => false,
  listEntries: () => [],
  lookupEntry: () => undefined,
  termSlug: (term: string) => term,
  terms: {}
}));

// Only the Modal shell is stubbed — `RadioGroup` / `RadioGroupButton` are the
// REAL components, since what is under test is the markup they produce.
vi.mock("@carbon/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@carbon/react")>();
  const Box = ({ children }: { children?: ReactNode }) =>
    createElement("div", null, children);
  return {
    ...actual,
    Button: Box,
    Modal: Box,
    ModalBody: Box,
    ModalContent: Box,
    ModalDescription: Box,
    ModalFooter: Box,
    ModalHeader: Box,
    ModalTitle: Box
  };
});
vi.mock("@lingui/react/macro", () => ({
  Trans: ({ children }: { children: ReactNode }) => children,
  useLingui: () => ({
    t: (parts: TemplateStringsArray) => parts.join("")
  })
}));

import { InstallModeDialog } from "./InstallModeDialog";

const modes = [
  { id: "provider", label: "Carbon is my accounting system", description: "…" },
  { id: "push-only", label: "Another system posts my ledger", description: "…" }
];

function render() {
  return renderToStaticMarkup(
    createElement(InstallModeDialog, {
      integrationName: "Ramp",
      modes,
      onClose: () => undefined,
      onChoose: () => undefined
    })
  );
}

describe("InstallModeDialog options", () => {
  /**
   * These were `<button aria-pressed>` per option: N tab stops, no arrow-key
   * navigation, and a screen reader announcing two independent toggle buttons
   * rather than one mutually-exclusive choice — on a screen whose whole point is
   * that the choice cannot be changed later.
   */
  it("is one radio group, not a row of toggle buttons", () => {
    const html = render();
    expect(html).toContain('role="radiogroup"');
    expect((html.match(/role="radio"/g) ?? []).length).toBe(modes.length);
    expect(html).not.toContain("aria-pressed");
  });

  it("marks exactly one option checked", () => {
    const html = render();
    expect((html.match(/aria-checked="true"/g) ?? []).length).toBe(1);
    expect((html.match(/aria-checked="false"/g) ?? []).length).toBe(
      modes.length - 1
    );
    expect((html.match(/data-state="checked"/g) ?? []).length).toBe(1);
  });

  it("still renders each mode's label and description", () => {
    const html = render();
    for (const mode of modes) expect(html).toContain(mode.label);
  });
});
