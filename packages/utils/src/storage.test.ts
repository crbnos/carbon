import { describe, expect, it } from "vitest";

import {
  buildCompanyPrivateStorageTarget,
  createCompanyPrivateSignedUrl,
  downloadCompanyPrivateObject,
  getCompanyPrivateBucket,
  hasCompanyPrivateObjectPathPrefix,
  listCompanyPrivateObjects
} from "./storage";

describe("storage helpers", () => {
  it("resolves the company private bucket from company id", () => {
    expect(getCompanyPrivateBucket("cmp_123")).toBe("cmp_123");
  });

  it("builds a company private storage target with explicit naming", () => {
    expect(
      buildCompanyPrivateStorageTarget({
        companyId: "cmp_123",
        logicalFolder: "job",
        entityId: "job_987",
        fileName: "work-instruction.pdf"
      })
    ).toEqual({
      physicalBucket: "cmp_123",
      logicalFolder: "job",
      objectPath: "cmp_123/job/job_987/work-instruction.pdf"
    });
  });

  it("normalizes path separators in folder, id, and file name", () => {
    expect(
      buildCompanyPrivateStorageTarget({
        companyId: "cmp_123",
        logicalFolder: "/parts/",
        entityId: "item/001",
        fileName: "folder\\model.step"
      })
    ).toEqual({
      physicalBucket: "cmp_123",
      logicalFolder: "parts",
      objectPath: "cmp_123/parts/item-001/folder-model.step"
    });
  });

  it("omits the entity segment when it is not provided", () => {
    expect(
      buildCompanyPrivateStorageTarget({
        companyId: "cmp_123",
        logicalFolder: "models",
        fileName: "render.png"
      })
    ).toEqual({
      physicalBucket: "cmp_123",
      logicalFolder: "models",
      objectPath: "cmp_123/models/render.png"
    });
  });

  it("validates the expected company prefix in private object paths", () => {
    expect(
      hasCompanyPrivateObjectPathPrefix(
        "cmp_123",
        "cmp_123/job/job_987/work-instruction.pdf"
      )
    ).toBe(true);
    expect(
      hasCompanyPrivateObjectPathPrefix(
        "cmp_123",
        "other-company/job/job_987/work-instruction.pdf"
      )
    ).toBe(false);
  });

  it("downloads from the company bucket directly", async () => {
    const bucketsTried: string[] = [];
    const result = await downloadCompanyPrivateObject({
      companyId: "cmp_123",
      objectPath: "cmp_123/job/job_987/work-instruction.pdf",
      requestedBucket: "cmp_123",
      downloadObject: async (physicalBucket) => {
        bucketsTried.push(physicalBucket);
        return { data: "company-file", error: null };
      }
    });

    expect(bucketsTried).toEqual(["cmp_123"]);
    expect(result).toEqual({
      data: "company-file",
      errors: [],
      physicalBucket: "cmp_123"
    });
  });

  it("captures download error if it fails", async () => {
    const result = await downloadCompanyPrivateObject({
      companyId: "cmp_123",
      objectPath: "cmp_123/job/job_987/work-instruction.pdf",
      requestedBucket: "cmp_123",
      downloadObject: async () => {
        return { data: null, error: { message: "Not found" } };
      }
    });

    expect(result).toEqual({
      data: null,
      errors: [{ physicalBucket: "cmp_123", error: { message: "Not found" } }]
    });
  });

  it("lists company files directly", async () => {
    const bucketsTried: string[] = [];
    const result = await listCompanyPrivateObjects({
      companyId: "cmp_123",
      objectPathPrefix: "cmp_123/job/job_987",
      requestedBucket: "cmp_123",
      listObjects: async (physicalBucket) => {
        bucketsTried.push(physicalBucket);
        return {
          data: [{ name: "new-file.pdf" }],
          error: null
        };
      },
      getItemKey: (item: { name: string }) => item.name
    });

    expect(bucketsTried).toEqual(["cmp_123"]);
    expect(result).toEqual({
      data: [{ name: "new-file.pdf" }],
      errors: []
    });
  });

  it("captures list errors", async () => {
    const result = await listCompanyPrivateObjects({
      companyId: "cmp_123",
      objectPathPrefix: "cmp_123/job/job_987",
      requestedBucket: "cmp_123",
      listObjects: async () => {
        return {
          data: null,
          error: { message: "Temporary storage error" }
        };
      },
      getItemKey: (item: { name: string }) => item.name
    });

    expect(result).toEqual({
      data: [],
      errors: [
        {
          physicalBucket: "cmp_123",
          error: { message: "Temporary storage error" }
        }
      ]
    });
  });

  it("creates a signed url from the company bucket directly", async () => {
    const result = await createCompanyPrivateSignedUrl({
      companyId: "cmp_123",
      objectPath: "cmp_123/job/job_987/work-instruction.pdf",
      requestedBucket: "cmp_123",
      expiresIn: 3600,
      createSignedUrl: async (physicalBucket) => {
        return {
          signedUrl: "https://example.com/company-file",
          error: null
        };
      }
    });

    expect(result).toEqual({
      errors: [],
      physicalBucket: "cmp_123",
      signedUrl: "https://example.com/company-file"
    });
  });

  it("captures signed url error", async () => {
    const result = await createCompanyPrivateSignedUrl({
      companyId: "cmp_123",
      objectPath: "cmp_123/job/job_987/work-instruction.pdf",
      requestedBucket: "cmp_123",
      expiresIn: 3600,
      createSignedUrl: async () => ({
        signedUrl: null,
        error: { message: "Failed" }
      })
    });

    expect(result).toEqual({
      errors: [
        {
          physicalBucket: "cmp_123",
          error: { message: "Failed" }
        }
      ],
      signedUrl: null
    });
  });
});
