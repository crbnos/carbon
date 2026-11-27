// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { formatLessonSection, parseLessonFile } from "./lessons";

const lesson = {
  id: "void-once",
  title: "Void an invoice once",
  paths: ["apps/erp/app/modules/invoicing/**"],
  triggers: ["voidInvoice", { text: ".update(", minCount: 2 }],
  body: "**Rule:** Claim the status first.\n\n```ts\n## not a heading\n```"
};

describe("parseLessonFile", () => {
  it("reads back a section that formatLessonSection wrote, code fences included", () => {
    expect(
      parseLessonFile(
        `# Invoicing lessons\n\n${formatLessonSection(lesson)}\n`,
        "x.md"
      )
    ).toEqual([{ ...lesson, rule: "Claim the status first." }]);
  });

  it("throws on a section with no scope block", () => {
    expect(() => parseLessonFile("## A lesson\n\nText.\n", "x.md")).toThrow(
      /no ```scope block/
    );
  });

  it("throws on a scope with no id", () => {
    expect(() =>
      parseLessonFile("## A lesson\n\n```scope\npaths: []\n```\n", "x.md")
    ).toThrow(/no id/);
  });
});
