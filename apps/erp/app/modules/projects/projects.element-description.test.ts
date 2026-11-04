// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  parseElementPlanFieldValue,
  projectElementValidator
} from "./projects.models";

const element = { type: "Task", name: "Pour the floor" } as const;
const document = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "Typed" }] }]
};

describe("a project element's description", () => {
  it("reads API text as Markdown", () => {
    const { description } = projectElementValidator.parse({
      ...element,
      description: "**Owner:** GM"
    });
    expect(description.type).toBe("doc");
    expect(description.content[0].content[0]).toMatchObject({
      text: "Owner:",
      marks: [{ type: "bold" }]
    });
  });

  it("keeps the New element modal's JSON document as it is", () => {
    const { description } = projectElementValidator.parse({
      ...element,
      description: JSON.stringify(document)
    });
    expect(description).toEqual(document);
  });

  it("stays absent when none is sent", () => {
    expect(projectElementValidator.parse(element).description).toBeUndefined();
  });

  it("takes Markdown and a document alike in a change request", () => {
    const markdown = parseElementPlanFieldValue("description", "**Owner:** GM");
    expect(markdown).toMatchObject({ value: { type: "doc" } });
    expect(
      parseElementPlanFieldValue("description", JSON.stringify(document))
    ).toEqual({ value: document });
    expect(parseElementPlanFieldValue("description", null)).toEqual({
      value: null
    });
  });
});
