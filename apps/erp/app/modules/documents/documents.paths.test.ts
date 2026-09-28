import { describe, expect, it } from "vitest";
import {
  buildDocumentUploadPath,
  buildStagedUploadPath,
  parseStagedUploadPath
} from "./documents.paths";

describe("staged upload path contract", () => {
  it("round-trips build → parse (the mint and registration must agree)", () => {
    const args = {
      companyId: "co_123",
      folder: "job",
      entityId: "job_456",
      name: "IMG_0123.heic"
    };
    expect(parseStagedUploadPath(buildStagedUploadPath(args))).toEqual(args);
  });

  it("rejects final document paths and traversal segments", () => {
    expect(
      parseStagedUploadPath(
        buildDocumentUploadPath({
          companyId: "co_123",
          folder: "job",
          entityId: "job_456",
          name: "a.pdf"
        })
      )
    ).toBeNull();
    expect(
      parseStagedUploadPath("co_123/tmp/uploads/job/../x.heic")
    ).toBeNull();
    expect(parseStagedUploadPath("co_123/tmp/abc123")).toBeNull();
  });
});
