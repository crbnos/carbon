// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { findDuplicateFileName } from "./image";
import {
  effectiveExtension,
  fileResponseHeaders,
  getContentType,
  getDocumentType,
  isHeic
} from "./media";

describe("fileResponseHeaders", () => {
  it("never renders a scriptable type as a page", () => {
    for (const type of [getContentType("svg"), getContentType("dae")]) {
      const headers = fileResponseHeaders(type, "private");
      expect(headers.get("Content-Disposition")).toBe("attachment");
      expect(headers.get("Content-Security-Policy")).toContain("sandbox");
      expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    }
  });
  it("leaves inert types inline, but never sniffed", () => {
    for (const ext of ["pdf", "png", "glb", "mp4"]) {
      const headers = fileResponseHeaders(getContentType(ext), "private");
      expect(headers.get("Content-Disposition")).toBeNull();
      expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    }
  });
});

describe("effectiveExtension", () => {
  it("unwraps the .zst compaction suffix to the underlying format", () => {
    expect(effectiveExtension("models/raw.step.zst")).toBe("step");
    expect(effectiveExtension("a/b/Photo.HEIC")).toBe("heic");
  });
});

describe("isHeic", () => {
  it("matches by extension even with no MIME (Windows reports none)", () => {
    expect(isHeic("IMG_0123.heic", "")).toBe(true);
    expect(isHeic("IMG_0123.HEIF")).toBe(true);
  });
  it("matches by MIME even with a stripped name", () => {
    expect(isHeic("upload", "image/heic")).toBe(true);
  });
  it("rejects everything else", () => {
    expect(isHeic("photo.jpg", "image/jpeg")).toBe(false);
  });
});

describe("getDocumentType", () => {
  it("classifies heic/heif/webp as images (the DocumentView gate)", () => {
    expect(getDocumentType("a.heic")).toBe("Image");
    expect(getDocumentType("a.heif")).toBe("Image");
    expect(getDocumentType("a.webp")).toBe("Image");
  });
  it("resolves model formats through supportedModelTypes", () => {
    expect(getDocumentType("a.step")).toBe("Model");
  });
});

describe("findDuplicateFileName", () => {
  it("catches the photo.heic + photo.jpg post-conversion collision", () => {
    const jpg = new File([], "photo.jpg");
    const converted = new File([], "photo.jpg");
    expect(findDuplicateFileName([jpg, converted])).toBe("photo.jpg");
    expect(findDuplicateFileName([jpg, new File([], "other.jpg")])).toBeNull();
  });
});
