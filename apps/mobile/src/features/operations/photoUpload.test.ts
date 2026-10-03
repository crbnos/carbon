// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  base64ToBytes,
  companyBucketName,
  safeFileName,
  stepPhotoPath
} from "./photoUpload";

/**
 * A step photo is evidence, and both of these are silent when wrong: a key
 * that leaves the company's prefix is refused by storage with an error about
 * something else, and a bad decode uploads a corrupt object while recording
 * the step as photographed.
 */

describe("stepPhotoPath", () => {
  it("is the shape the web writes and the portal authorizes against", () => {
    expect(
      stepPhotoPath({
        companyId: "cmp1",
        jobOperationId: "op1",
        stepId: "st1",
        unique: "abc123",
        fileName: "weld.jpg"
      })
    ).toBe("cmp1/job/op1/st1/abc123/weld.jpg");
  });

  it("always starts with the companyId", () => {
    // This is the whole tenant boundary: @carbon/files' company bucket refuses
    // any key that does not start with the company's own prefix.
    const path = stepPhotoPath({
      companyId: "cmp1",
      jobOperationId: "op1",
      stepId: "st1",
      unique: "u",
      fileName: "../../escape.jpg"
    });
    expect(path.startsWith("cmp1/")).toBe(true);
    expect(path).not.toContain("..");
  });
});

describe("safeFileName", () => {
  it("strips what a storage key cannot carry", () => {
    expect(safeFileName("weld photo.jpg")).toBe("weld-photo.jpg");
    expect(safeFileName("a/b\\c.jpg")).toBe("a-b-c.jpg");
    expect(safeFileName("Drawing #3.pdf")).toBe("Drawing-3.pdf");
  });

  it("never returns an empty name", () => {
    // An empty final segment makes the key end in "/", which storage treats
    // as a folder and the upload fails on something unrelated.
    expect(safeFileName("")).toBe("photo.jpg");
    expect(safeFileName("///")).toBe("photo.jpg");
    expect(safeFileName("...")).toBe("photo.jpg");
  });
});

describe("companyBucketName", () => {
  it("mirrors getCompanyPrivateBucket", () => {
    expect(companyBucketName("cmp1")).toBe("cmp1");
    expect(companyBucketName(" cmp1 ")).toBe("cmp1");
    expect(companyBucketName("/cmp1/")).toBe("cmp1");
  });

  it('refuses an empty company rather than probing bucket ""', () => {
    expect(() => companyBucketName("")).toThrow();
    expect(() => companyBucketName("  ")).toThrow();
    expect(() => companyBucketName("///")).toThrow();
  });
});

describe("base64ToBytes", () => {
  /** Encodes with Node's Buffer so the expectation is independent of the code. */
  const encode = (text: string) => Buffer.from(text, "utf8").toString("base64");

  it("round-trips through Node's own encoder", () => {
    for (const text of ["a", "ab", "abc", "abcd", "hello world", "✓ ok"]) {
      expect(Buffer.from(base64ToBytes(encode(text))).toString("utf8")).toBe(
        text
      );
    }
  });

  it("gets the length right at every padding", () => {
    // Off-by-one here is a truncated or zero-padded image.
    expect(base64ToBytes(encode("a")).length).toBe(1);
    expect(base64ToBytes(encode("ab")).length).toBe(2);
    expect(base64ToBytes(encode("abc")).length).toBe(3);
    expect(base64ToBytes(encode("abcd")).length).toBe(4);
  });

  it("decodes real binary, not just text", () => {
    const bytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    const decoded = base64ToBytes(Buffer.from(bytes).toString("base64"));
    expect(Array.from(decoded)).toEqual(Array.from(bytes));
  });

  it("tolerates a data URI prefix and whitespace", () => {
    expect(
      Buffer.from(
        base64ToBytes(`data:image/jpeg;base64,${encode("hi")}`)
      ).toString("utf8")
    ).toBe("hi");
    expect(Buffer.from(base64ToBytes("aGVs\nbG8=")).toString("utf8")).toBe(
      "hello"
    );
  });

  it("throws rather than returning a truncated image", () => {
    expect(() => base64ToBytes("not base64!!")).toThrow();
    // Length not a multiple of 4: the encoder was interrupted.
    expect(() => base64ToBytes("aGVsbG8")).toThrow();
  });

  it("is empty for an empty string", () => {
    expect(base64ToBytes("").length).toBe(0);
  });
});
