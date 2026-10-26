// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  getYouTubeVideoId,
  isValidTrainingGuideKey,
  TRAINING_CERTIFICATE_MAX_BYTES,
  trainingAssignmentValidator,
  trainingGuideKeyPrefix,
  validateTrainingCertificate
} from "./resources.models";

describe("isValidTrainingGuideKey", () => {
  const prefix = trainingGuideKeyPrefix("c1", "t1");

  it("accepts one upload folder and one file", () => {
    expect(
      isValidTrainingGuideKey("c1/training/t1/abc/Welder Guide.pdf", prefix)
    ).toBe(true);
  });

  it.each([
    "c2/training/t1/abc/guide.pdf",
    "c1/training/t2/abc/guide.pdf",
    "c1/training/t1/guide.pdf",
    "c1/training/t1/abc/d/guide.pdf",
    "c1/training/t1/../x.pdf",
    "c1/training/t1/abc/"
  ])("refuses %s", (key) => {
    expect(isValidTrainingGuideKey(key, prefix)).toBe(false);
  });
});

describe("getYouTubeVideoId", () => {
  it.each([
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://youtube.com/watch?v=dQw4w9WgXcQ&t=42s",
    "https://m.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://youtu.be/dQw4w9WgXcQ?si=abc",
    "https://www.youtube.com/shorts/dQw4w9WgXcQ",
    "https://www.youtube.com/live/dQw4w9WgXcQ",
    "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    "  https://www.youtube.com/watch?v=dQw4w9WgXcQ  "
  ])("reads the id from %s", (url) => {
    expect(getYouTubeVideoId(url)).toBe("dQw4w9WgXcQ");
  });

  it.each([
    "",
    "not a url",
    "https://vimeo.com/123456789",
    "https://www.youtube.com/",
    "https://www.youtube.com/watch?v=short",
    "https://evil.com/watch?v=dQw4w9WgXcQ",
    "https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ",
    "javascript:alert(1)//youtu.be/dQw4w9WgXcQ"
  ])("refuses %s", (url) => {
    expect(getYouTubeVideoId(url)).toBeNull();
  });
});

describe("validateTrainingCertificate", () => {
  const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d];
  const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const JPG = [0xff, 0xd8, 0xff];
  const file = (name: string, head: number[] = [], size = 10) => {
    const bytes = new Uint8Array(Math.max(size, head.length));
    bytes.set(head);
    return new File([bytes], name);
  };

  it.each([
    ["cert.PDF", PDF, "pdf"],
    ["photo.jpeg", JPG, "jpeg"],
    ["scan.png", PNG, "png"]
  ])("accepts %s by its leading bytes", async (name, head, extension) => {
    expect(
      (await validateTrainingCertificate(file(name, head))).extension
    ).toBe(extension);
  });

  it.each([
    ["no file", null],
    ["an empty file", file("cert.pdf", [], 0)],
    ["another type", file("notes.txt")],
    ["a HEIC photo", file("photo.heic")],
    ["PNG bytes named .pdf", file("cert.pdf", PNG)],
    ["a .png with no signature", file("scan.png")],
    [
      "a file over the size limit",
      file("cert.pdf", PDF, TRAINING_CERTIFICATE_MAX_BYTES + 1)
    ]
  ])("refuses %s", async (_, input) => {
    expect((await validateTrainingCertificate(input)).file).toBeNull();
  });
});

// An external assignment has a name and no training; an internal one has a
// training. Each must refuse the other's missing field.
describe("trainingAssignmentValidator", () => {
  it.each([
    [{ isExternal: false, trainingId: "trn_1" }, true],
    [{ isExternal: false }, false],
    [{ isExternal: true, name: "Forklift Safety" }, true],
    [{ isExternal: true, name: "  " }, false]
  ])("%o parses: %s", (input, success) => {
    expect(
      trainingAssignmentValidator.safeParse({ ...input, groupIds: ["grp_1"] })
        .success
    ).toBe(success);
  });
});
