import { describe, expect, it } from "vitest";
import { isSupportedSlideImagePath, sniffSlideImageType } from "./file";

// Minimal container headers — enough bytes for the sniffer to reach a verdict.
const header = (...bytes: number[]) =>
  new Blob([new Uint8Array([...bytes, ...new Array(16).fill(0)])]);
const ascii = (text: string) => Array.from(text, (c) => c.charCodeAt(0));

const PNG = header(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
const JPEG = header(0xff, 0xd8, 0xff, 0xe0);
const GIF = header(...ascii("GIF89a"));
const WEBP = header(...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WEBP"));
const AVIF = header(0, 0, 0, 0x20, ...ascii("ftypavif"));
// The iPhone camera default: same ISO-BMFF container as AVIF, different brand —
// the brand check is the only thing separating them.
const HEIC = header(0, 0, 0, 0x20, ...ascii("ftypheic"));

describe("sniffSlideImageType", () => {
  it("identifies every format a browser can paint", async () => {
    expect(await sniffSlideImageType(PNG)).toBe("png");
    expect(await sniffSlideImageType(JPEG)).toBe("jpg");
    expect(await sniffSlideImageType(GIF)).toBe("gif");
    expect(await sniffSlideImageType(WEBP)).toBe("webp");
    expect(await sniffSlideImageType(AVIF)).toBe("avif");
  });

  it("rejects HEIC even though it shares AVIF's container", async () => {
    expect(await sniffSlideImageType(HEIC)).toBeNull();
  });

  it("rejects a file too short to identify", async () => {
    expect(await sniffSlideImageType(new Blob([new Uint8Array([0xff])]))).toBe(
      null
    );
  });

  it("ignores the filename — a renamed HEIC is still rejected", async () => {
    const renamed = new File([HEIC], "fixture-setup.jpg", {
      type: "image/jpeg"
    });
    expect(await sniffSlideImageType(renamed)).toBeNull();
  });
});

describe("isSupportedSlideImagePath", () => {
  it("accepts stored paths in a displayable format, case-insensitively", () => {
    expect(isSupportedSlideImagePath("co/parts/abc.png")).toBe(true);
    expect(isSupportedSlideImagePath("co/parts/abc.JPG")).toBe(true);
    expect(isSupportedSlideImagePath("co/parts/abc.avif")).toBe(true);
  });

  it("rejects formats the MES can't paint, and paths with no extension", () => {
    expect(isSupportedSlideImagePath("co/parts/abc.heic")).toBe(false);
    expect(isSupportedSlideImagePath("co/parts/abc.tiff")).toBe(false);
    // svg renders, but the preview route serves it same-origin with no CSP.
    expect(isSupportedSlideImagePath("co/parts/abc.svg")).toBe(false);
    expect(isSupportedSlideImagePath("co/parts/abc")).toBe(false);
    expect(isSupportedSlideImagePath(null)).toBe(false);
  });
});
