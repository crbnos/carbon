import { describe, expect, it } from "vitest";
import { documentHasImages } from "./tiptap";

describe("documentHasImages", () => {
  it("returns false for empty / textless documents", () => {
    expect(documentHasImages(null)).toBe(false);
    expect(documentHasImages(undefined)).toBe(false);
    expect(documentHasImages({})).toBe(false);
    expect(documentHasImages({ type: "doc", content: [] })).toBe(false);
    expect(
      documentHasImages({
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "hello" }] }
        ]
      })
    ).toBe(false);
  });

  it("detects a top-level image node (image-only description)", () => {
    expect(
      documentHasImages({
        type: "doc",
        content: [
          { type: "image", attrs: { src: "/file/preview/private/x.png" } }
        ]
      })
    ).toBe(true);
  });

  it("detects updatedImage and deeply nested images", () => {
    expect(
      documentHasImages({
        type: "doc",
        content: [{ type: "updatedImage", attrs: { src: "a.png" } }]
      })
    ).toBe(true);
    expect(
      documentHasImages({
        type: "doc",
        content: [
          {
            type: "bulletList",
            content: [
              {
                type: "listItem",
                content: [{ type: "image", attrs: { src: "b.png" } }]
              }
            ]
          }
        ]
      })
    ).toBe(true);
  });
});
