// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { pickResumableUpload } from "./resumable-upload";

const stored = (bucketName: string, objectName: string) => ({
  metadata: { bucketName, objectName }
});

const options = {
  bucket: "temp-staging",
  path: "co1/models/NEW.stl",
  running: new Set<string>()
};

describe("pickResumableUpload", () => {
  it("resumes an earlier upload of the file to the same company's models", () => {
    const earlier = stored("temp-staging", "co1/models/OLD.stl");
    expect(pickResumableUpload([earlier], options)).toBe(earlier);
  });

  it("never resumes another company's upload, or another bucket's", () => {
    expect(
      pickResumableUpload(
        [
          stored("temp-staging", "co2/models/OLD.stl"),
          stored("private", "co1/models/OLD.stl")
        ],
        options
      )
    ).toBeUndefined();
  });

  it("skips an upload still running in this tab", () => {
    expect(
      pickResumableUpload([stored("temp-staging", "co1/models/OLD.stl")], {
        ...options,
        running: new Set(["co1/models/OLD.stl"])
      })
    ).toBeUndefined();
  });

  it("prefers the upload the page offered to continue", () => {
    const first = stored("temp-staging", "co1/models/A.stl");
    const offered = stored("temp-staging", "co1/models/B.stl");
    expect(
      pickResumableUpload([first, offered], {
        ...options,
        preferPath: "co1/models/B.stl"
      })
    ).toBe(offered);
  });
});
