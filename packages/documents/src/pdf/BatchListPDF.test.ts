// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ReactElement, ReactNode } from "react";
import { Children, isValidElement } from "react";
import { describe, expect, it } from "vitest";
import { BatchListPDF } from "./BatchListPDF";
import { SAMPLE_JOB_TRAVELER } from "./jobTraveler.samples";
import { breakLongNotesWord } from "./notesText";

/** Every string the batch list prints, read off its element tree. */
function printedText(notes: string | null | undefined): string[] {
  const document = (BatchListPDF as (p: never) => ReactElement)({
    company: SAMPLE_JOB_TRAVELER.company,
    batch: {
      readableId: "BAT000001",
      status: "Active",
      createdAt: "2026-10-01T08:00:00Z"
    },
    processName: "Laser Cutting",
    workCenterName: null,
    members: [],
    notes
  } as never);
  const texts: string[] = [];
  const walk = (node: ReactNode) =>
    Children.forEach(node, (child) => {
      if (typeof child === "string") texts.push(child);
      if (!isValidElement(child)) return;
      walk((child.props as { children?: ReactNode }).children);
    });
  walk((document.props as { children?: ReactNode }).children);
  return texts;
}

describe("Batch list notes", () => {
  it("print as typed, line breaks included", () => {
    const notes = "Cut on the fiber laser.\nDeburr every edge.";
    const texts = printedText(notes);
    expect(texts).toContain("Batch Notes");
    expect(texts).toContain(notes);
  });

  it("are left out when the batch has none", () => {
    for (const notes of [null, undefined, "", "  \n "]) {
      expect(printedText(notes)).not.toContain("Batch Notes");
    }
  });
});

describe("breakLongNotesWord", () => {
  it("keeps a word that fits on a line whole", () => {
    expect(breakLongNotesWord("Deburr")).toEqual(["Deburr"]);
    expect(breakLongNotesWord("x".repeat(40))).toEqual(["x".repeat(40)]);
  });

  it("lets a longer word break every 40 characters", () => {
    const url = `https://example.com/${"a".repeat(80)}`;
    const parts = breakLongNotesWord(url);
    expect(parts.join("")).toBe(url);
    expect(parts.every((part) => part.length <= 40)).toBe(true);
    expect(parts).toHaveLength(3);
  });
});
