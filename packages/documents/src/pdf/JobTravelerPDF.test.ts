// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ReactElement, ReactNode } from "react";
import { Children, isValidElement } from "react";
import { describe, expect, it } from "vitest";
import { getDefaultTemplate } from "../template";
import { JobTravelerPageContent } from "./JobTravelerPDF";
import { SAMPLE_JOB_TRAVELER } from "./jobTraveler.samples";

type Block = { type: string; showWorkInstructions?: boolean };

// The page renders one Fragment per visible block, each wrapping the element
// its registry entry returned; the operations entry passes `block` through.
function operationsBlock(template: unknown): Block | undefined {
  const page = (JobTravelerPageContent as (p: never) => ReactElement)({
    ...SAMPLE_JOB_TRAVELER,
    template
  } as never);
  const found: Block[] = [];
  const walk = (node: ReactNode) =>
    Children.forEach(node, (child) => {
      if (!isValidElement(child)) return;
      const props = child.props as { block?: Block; children?: ReactNode };
      if (props.block?.type === "operations") found.push(props.block);
      walk(props.children);
    });
  walk((page.props as { children?: ReactNode }).children);
  return found[0];
}

// The MES traveler link once rendered without the company's template, so the
// default (instructions off) won over "Show work instructions".
describe("Job Traveler work instructions", () => {
  it("follow the template's operations block", () => {
    const template = getDefaultTemplate("jobTraveler");
    const withInstructions = {
      ...template,
      blocks: template.blocks.map((block) =>
        block.type === "operations"
          ? { ...block, showWorkInstructions: true }
          : block
      )
    };
    expect(operationsBlock(withInstructions)?.showWorkInstructions).toBe(true);
  });

  it("are off without a template", () => {
    expect(operationsBlock(null)?.showWorkInstructions).toBe(false);
  });
});
