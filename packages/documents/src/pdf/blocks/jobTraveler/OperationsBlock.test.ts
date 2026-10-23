// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ReactElement, ReactNode } from "react";
import { Children, isValidElement } from "react";
import { describe, expect, it } from "vitest";
import { SAMPLE_JOB_TRAVELER } from "../../jobTraveler.samples";
import { OperationsBlock } from "./OperationsBlock";

type Rendered = { texts: string[]; images: number };

/** Every text and image the block draws for one operation. */
function render(operation: Record<string, unknown>): Rendered {
  const tree = OperationsBlock({
    block: { type: "operations", showWorkInstructions: false },
    data: {
      ...SAMPLE_JOB_TRAVELER,
      jobOperations: [{ ...SAMPLE_JOB_TRAVELER.jobOperations[0], ...operation }]
    }
  } as never) as ReactElement;
  const rendered: Rendered = { texts: [], images: 0 };
  const walk = (node: ReactNode) =>
    Children.forEach(node, (child) => {
      if (typeof child === "string" || typeof child === "number") {
        rendered.texts.push(String(child));
        return;
      }
      if (!isValidElement(child)) return;
      const props = child.props as { src?: string; children?: ReactNode };
      if (props.src) rendered.images += 1;
      walk(props.children);
    });
  walk(tree);
  return rendered;
}

describe("Job traveler operations", () => {
  it("print start and complete codes on an operation in no batch", () => {
    const { texts, images } = render({ jobOperationBatch: null });
    expect(texts).toEqual(
      expect.arrayContaining([
        "Actions",
        "Setup",
        "Labor",
        "Machine",
        "Complete"
      ])
    );
    expect(images).toBe(4);
  });

  it("print the batch, its notes and one open code on a batched operation", () => {
    const { texts, images } = render({
      jobOperationBatch: {
        readableId: "BAT000012",
        notes: "Furnace 2, program 7.\nTop rack first."
      }
    });
    expect(texts).toEqual(
      expect.arrayContaining([
        "Batch BAT000012",
        "Open in MES",
        "Batch Notes",
        "Furnace 2, program 7.\nTop rack first."
      ])
    );
    expect(texts).not.toContain("Actions");
    expect(texts).not.toContain("Complete");
    expect(texts).not.toContain("Labor");
    expect(images).toBe(1);
  });

  it("leave out an empty notes block", () => {
    const { texts } = render({
      jobOperationBatch: { readableId: "BAT000012", notes: "  " }
    });
    expect(texts).toContain("Batch BAT000012");
    expect(texts).not.toContain("Batch Notes");
  });
});
