import { describe, expect, it } from "vitest";
import type { TiptapNode } from "./provenance";
import {
  buildOnshapeItemNotesBlock,
  ONSHAPE_NOTES_BLOCK_END,
  ONSHAPE_NOTES_BLOCK_START,
  upsertOnshapeNotesBlock
} from "./provenance";

// `item.notes` is user-editable. Every one of these cases is a way a customer
// loses text they wrote if the splice is wrong, so the contract is pinned
// rather than trusted: replace only between the sentinels, never truncate, and
// produce a byte-identical document when nothing about the release changed.

function block(overrides: Record<string, unknown> = {}) {
  return buildOnshapeItemNotesBlock({
    releaseName: "TB-REL-001 Test Bench Erstfreigabe",
    releaseNotes: "Initial release of the TB test bench assembly.",
    partNumber: "TB-900",
    revision: "A",
    documentId: "doc-1",
    versionId: "ver-1",
    elementId: "el-1",
    releaseId: "rp-1",
    ...overrides
  });
}

function human(text: string): TiptapNode {
  return { type: "paragraph", content: [{ type: "text", text }] };
}

function textOf(doc: TiptapNode): string[] {
  return (doc.content ?? []).map((node: TiptapNode) =>
    (node.content ?? []).map((child: TiptapNode) => child.text ?? "").join("")
  );
}

describe("buildOnshapeItemNotesBlock", () => {
  it("opens and closes with the sentinels", () => {
    const nodes = block();
    expect(textOf({ type: "doc", content: nodes })[0]).toBe(
      ONSHAPE_NOTES_BLOCK_START
    );
    expect(textOf({ type: "doc", content: nodes }).at(-1)).toBe(
      ONSHAPE_NOTES_BLOCK_END
    );
  });

  it("omits release name and notes when the touch had no release", () => {
    // The BOM-import path has no release at all — identity half only.
    const lines = textOf({
      type: "doc",
      content: block({ releaseName: null, releaseNotes: null, releaseId: null })
    });
    expect(lines.join("\n")).not.toContain("Release: ");
    expect(lines.join("\n")).not.toContain("Release notes");
    expect(lines.join("\n")).toContain("Part number: TB-900");
  });

  it("splits multi-line release notes into paragraphs", () => {
    const lines = textOf({
      type: "doc",
      content: block({ releaseNotes: "first line\nsecond line" })
    });
    expect(lines).toContain("first line");
    expect(lines).toContain("second line");
  });

  it("carries nothing that varies between runs", () => {
    // The block must be a pure function of the RELEASE. An earlier version
    // rendered an "Imported:" timestamp, which made every webhook redelivery
    // rewrite the item — an audit-log row and a customer webhook delivery for a
    // note whose content had not changed. Caught in live testing, not here,
    // because a unit test passes the same clock value twice.
    expect(JSON.stringify(block())).toBe(JSON.stringify(block()));
    const rendered = JSON.stringify(block());
    expect(rendered).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  it("NEVER emits an empty text node", () => {
    // ProseMirror text nodes cannot be empty and Node.fromJSON THROWS on one,
    // which takes the whole editor down — the item's notes render as a blank
    // box with no error anywhere. Shipped once: the "Release notes:" label
    // emitted a paired empty value. Found in the browser, not here.
    const walk = (nodes: TiptapNode[]): void => {
      for (const node of nodes) {
        if (node.type === "text") expect(node.text).toBeTruthy();
        if (node.content) walk(node.content);
      }
    };
    walk(block());
    walk(block({ releaseNotes: null, releaseName: null, releaseId: null }));
    walk(block({ partNumber: null, revision: null }));
  });
});

describe("upsertOnshapeNotesBlock", () => {
  it("creates a document from empty notes in every empty form", () => {
    for (const empty of [undefined, null, {}, "", 42]) {
      const { doc, orphanedStart } = upsertOnshapeNotesBlock(empty, block());
      expect(doc.type).toBe("doc");
      expect(textOf(doc)[0]).toBe(ONSHAPE_NOTES_BLOCK_START);
      expect(orphanedStart).toBe(false);
    }
  });

  it("appends to a document that has no block yet, preserving human text", () => {
    const existing: TiptapNode = {
      type: "doc",
      content: [human("Inspect the bore before assembly.")]
    };
    const { doc } = upsertOnshapeNotesBlock(existing, block());
    expect(textOf(doc)[0]).toBe("Inspect the bore before assembly.");
    expect(textOf(doc)[1]).toBe(ONSHAPE_NOTES_BLOCK_START);
  });

  it("preserves human text ABOVE and BELOW on an in-place replace", () => {
    const first = upsertOnshapeNotesBlock(
      { type: "doc", content: [human("above")] },
      block()
    ).doc;
    const withBelow: TiptapNode = {
      type: "doc",
      content: [...(first.content ?? []), human("below")]
    };

    const { doc } = upsertOnshapeNotesBlock(
      withBelow,
      block({ releaseName: "REL-002", revision: "B" })
    );

    const lines = textOf(doc);
    expect(lines[0]).toBe("above");
    expect(lines.at(-1)).toBe("below");
    expect(lines.join("\n")).toContain("REL-002");
    expect(lines.join("\n")).not.toContain("TB-REL-001");
  });

  it("replaces in place rather than appending a second block", () => {
    const once = upsertOnshapeNotesBlock({}, block()).doc;
    const twice = upsertOnshapeNotesBlock(once, block({ revision: "B" })).doc;
    const starts = textOf(twice).filter(
      (line) => line === ONSHAPE_NOTES_BLOCK_START
    );
    expect(starts).toHaveLength(1);
  });

  it("is idempotent — same input twice gives a byte-identical document", () => {
    const once = upsertOnshapeNotesBlock({}, block()).doc;
    const twice = upsertOnshapeNotesBlock(once, block()).doc;
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
  });

  it("matches a sentinel a user has bolded", () => {
    const marked: TiptapNode = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              marks: [{ type: "bold" }],
              text: ONSHAPE_NOTES_BLOCK_START
            }
          ]
        },
        human("stale body"),
        human(ONSHAPE_NOTES_BLOCK_END),
        human("below")
      ]
    };
    const { doc } = upsertOnshapeNotesBlock(marked, block());
    const lines = textOf(doc);
    expect(lines).not.toContain("stale body");
    expect(lines.at(-1)).toBe("below");
  });

  it("APPENDS and reports when a start has no end — never truncates", () => {
    const orphan: TiptapNode = {
      type: "doc",
      content: [
        human(ONSHAPE_NOTES_BLOCK_START),
        human("important human text after an orphaned sentinel")
      ]
    };
    const { doc, orphanedStart } = upsertOnshapeNotesBlock(orphan, block());
    expect(orphanedStart).toBe(true);
    expect(textOf(doc)).toContain(
      "important human text after an orphaned sentinel"
    );
  });

  it("replaces only the FIRST block when a second was hand-pasted", () => {
    const doubled: TiptapNode = {
      type: "doc",
      content: [
        human(ONSHAPE_NOTES_BLOCK_START),
        human("first body"),
        human(ONSHAPE_NOTES_BLOCK_END),
        human(ONSHAPE_NOTES_BLOCK_START),
        human("second body"),
        human(ONSHAPE_NOTES_BLOCK_END)
      ]
    };
    const { doc } = upsertOnshapeNotesBlock(doubled, block());
    const lines = textOf(doc);
    expect(lines).not.toContain("first body");
    expect(lines).toContain("second body");
  });
});
