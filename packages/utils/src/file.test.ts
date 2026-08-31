import { describe, expect, it } from "vitest";
import {
  isSupportedSlideImagePath,
  SLIDE_IMAGE_HEADER_BYTES,
  sniffSlideImageType
} from "./file";

// Minimal container headers — enough bytes for the sniffer to reach a verdict.
const header = (...bytes: number[]) =>
  new Uint8Array([
    ...bytes,
    ...new Array(SLIDE_IMAGE_HEADER_BYTES).fill(0)
  ]).slice(0, SLIDE_IMAGE_HEADER_BYTES);
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
  it("identifies every format a browser can paint", () => {
    expect(sniffSlideImageType(PNG)).toBe("png");
    expect(sniffSlideImageType(JPEG)).toBe("jpg");
    expect(sniffSlideImageType(GIF)).toBe("gif");
    expect(sniffSlideImageType(WEBP)).toBe("webp");
    expect(sniffSlideImageType(AVIF)).toBe("avif");
  });

  it("rejects HEIC even though it shares AVIF's container", () => {
    expect(sniffSlideImageType(HEIC)).toBeNull();
  });

  it("rejects a header too short to identify", () => {
    expect(sniffSlideImageType(new Uint8Array([0xff]))).toBeNull();
  });

  it("reads only the header, so a renamed file is judged on its bytes", () => {
    // What the upload layer passes for `fixture-setup.jpg` that is really HEIC.
    expect(sniffSlideImageType(HEIC.slice(0, SLIDE_IMAGE_HEADER_BYTES))).toBe(
      null
    );
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
