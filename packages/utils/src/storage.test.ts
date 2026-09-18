import { describe, expect, it, vi } from "vitest";
import {
  buildCompanyPrivateStorageTarget,
  createCompanyPrivateSignedUrl,
  downloadCompanyPrivateObject,
  getCompanyPrivateBucket,
  hasCompanyPrivateObjectPathPrefix,
  LEGACY_PRIVATE_BUCKET,
  listCompanyPrivateObjects,
  normalizeStorageSegment,
  removeCompanyPrivateObjects,
  type StorageClientLike
} from "./storage";

const ok = <T>(data: T) => Promise.resolve({ data, error: null });
const fail = (message: string) =>
  Promise.resolve({ data: null, error: { message } });

const makeStorage = (
  buckets: Record<string, Partial<ReturnType<StorageClientLike["from"]>>>
): StorageClientLike => ({
  from: (bucket: string) =>
    ({
      download: vi.fn(() => fail("not found")),
      createSignedUrl: vi.fn(() => fail("not found")),
      list: vi.fn(() => ok([])),
      remove: vi.fn(() => ok([])),
      ...buckets[bucket]
    }) as ReturnType<StorageClientLike["from"]>
});

describe("normalizeStorageSegment", () => {
  it("trims and collapses separators", () => {
    expect(normalizeStorageSegment("  abc  ")).toBe("abc");
    expect(normalizeStorageSegment("a/b\\c")).toBe("a-b-c");
    expect(normalizeStorageSegment("/abc/")).toBe("abc");
    expect(normalizeStorageSegment("-abc-")).toBe("abc");
  });
});

describe("getCompanyPrivateBucket", () => {
  it("is the normalized companyId", () => {
    expect(getCompanyPrivateBucket("cs868u84gfk07v78v9e0")).toBe(
      "cs868u84gfk07v78v9e0"
    );
    expect(getCompanyPrivateBucket(" abc ")).toBe("abc");
  });

  it('refuses an empty companyId rather than resolving bucket ""', () => {
    expect(() => getCompanyPrivateBucket("")).toThrow();
    expect(() => getCompanyPrivateBucket(" / ")).toThrow();
  });
});

describe("buildCompanyPrivateStorageTarget", () => {
  it("keeps companyId as the first path segment", () => {
    expect(
      buildCompanyPrivateStorageTarget({
        companyId: "co1",
        logicalFolder: "opportunity-line",
        entityId: "ol1",
        fileName: "drawing.pdf"
      })
    ).toEqual({
      physicalBucket: "co1",
      logicalFolder: "opportunity-line",
      objectPath: "co1/opportunity-line/ol1/drawing.pdf"
    });
  });

  it("omits a missing entityId", () => {
    expect(
      buildCompanyPrivateStorageTarget({
        companyId: "co1",
        logicalFolder: "parts",
        fileName: "spec.pdf"
      }).objectPath
    ).toBe("co1/parts/spec.pdf");
  });

  it("normalizes hostile segments", () => {
    expect(
      buildCompanyPrivateStorageTarget({
        companyId: "co1",
        logicalFolder: "docs",
        fileName: "a/b.pdf"
      }).objectPath
    ).toBe("co1/docs/a-b.pdf");
  });
});

describe("hasCompanyPrivateObjectPathPrefix", () => {
  it("requires the companyId segment prefix", () => {
    expect(hasCompanyPrivateObjectPathPrefix("co1", "co1/docs/a.pdf")).toBe(
      true
    );
    expect(hasCompanyPrivateObjectPathPrefix("co1", "co12/docs/a.pdf")).toBe(
      false
    );
    expect(hasCompanyPrivateObjectPathPrefix("co1", "other/co1/a.pdf")).toBe(
      false
    );
  });

  it("never matches for an empty companyId", () => {
    expect(hasCompanyPrivateObjectPathPrefix("", "/models/a.step")).toBe(false);
    expect(hasCompanyPrivateObjectPathPrefix("", "anything")).toBe(false);
  });
});

describe("downloadCompanyPrivateObject", () => {
  it("returns from the company bucket without touching legacy", async () => {
    const blob = new Blob(["x"]);
    const legacyDownload = vi.fn(() => fail("should not be called"));
    const storage = makeStorage({
      co1: { download: vi.fn(() => ok(blob)) },
      [LEGACY_PRIVATE_BUCKET]: { download: legacyDownload }
    });

    const result = await downloadCompanyPrivateObject({
      storage,
      companyId: "co1",
      objectPath: "co1/docs/a.pdf"
    });

    expect(result.data).toBe(blob);
    expect(result.physicalBucket).toBe("co1");
    expect(result.errors).toHaveLength(0);
    expect(legacyDownload).not.toHaveBeenCalled();
  });

  it("falls back to the legacy bucket on a company miss", async () => {
    const blob = new Blob(["x"]);
    const storage = makeStorage({
      co1: { download: vi.fn(() => fail("not found")) },
      [LEGACY_PRIVATE_BUCKET]: { download: vi.fn(() => ok(blob)) }
    });

    const result = await downloadCompanyPrivateObject({
      storage,
      companyId: "co1",
      objectPath: "co1/docs/a.pdf"
    });

    expect(result.data).toBe(blob);
    expect(result.physicalBucket).toBe(LEGACY_PRIVATE_BUCKET);
    expect(result.errors).toEqual([
      { bucket: "co1", error: { message: "not found" } }
    ]);
  });

  it("reports both errors when neither bucket has the object", async () => {
    const storage = makeStorage({});
    const result = await downloadCompanyPrivateObject({
      storage,
      companyId: "co1",
      objectPath: "co1/docs/a.pdf"
    });
    expect(result.data).toBeNull();
    expect(result.physicalBucket).toBeNull();
    expect(result.errors).toHaveLength(2);
  });

  it("refuses a path outside the company prefix without touching storage", async () => {
    const companyDownload = vi.fn(() => fail("should not be called"));
    const legacyDownload = vi.fn(() => fail("should not be called"));
    const storage = makeStorage({
      co1: { download: companyDownload },
      [LEGACY_PRIVATE_BUCKET]: { download: legacyDownload }
    });

    const result = await downloadCompanyPrivateObject({
      storage,
      companyId: "co1",
      objectPath: "co2/docs/a.pdf"
    });

    expect(result.data).toBeNull();
    expect(result.physicalBucket).toBeNull();
    expect(result.errors).toHaveLength(1);
    expect(companyDownload).not.toHaveBeenCalled();
    expect(legacyDownload).not.toHaveBeenCalled();
  });
});

describe("createCompanyPrivateSignedUrl", () => {
  it("prefers the company bucket and falls back to legacy", async () => {
    const storage = makeStorage({
      co1: { createSignedUrl: vi.fn(() => fail("not found")) },
      [LEGACY_PRIVATE_BUCKET]: {
        createSignedUrl: vi.fn(() => ok({ signedUrl: "https://x/y" }))
      }
    });

    const result = await createCompanyPrivateSignedUrl({
      storage,
      companyId: "co1",
      objectPath: "co1/docs/a.pdf",
      expiresIn: 3600
    });

    expect(result.signedUrl).toBe("https://x/y");
    expect(result.physicalBucket).toBe(LEGACY_PRIVATE_BUCKET);
    expect(result.errors).toHaveLength(1);
  });

  it("refuses a path outside the company prefix without touching storage", async () => {
    const legacySign = vi.fn(() => ok({ signedUrl: "https://leak" }));
    const storage = makeStorage({
      [LEGACY_PRIVATE_BUCKET]: { createSignedUrl: legacySign }
    });

    const result = await createCompanyPrivateSignedUrl({
      storage,
      companyId: "co1",
      objectPath: "co2/docs/a.pdf",
      expiresIn: 3600
    });

    expect(result.signedUrl).toBeNull();
    expect(result.errors).toHaveLength(1);
    expect(legacySign).not.toHaveBeenCalled();
  });
});

describe("listCompanyPrivateObjects", () => {
  it("unions both buckets with the company bucket winning ties", async () => {
    const storage = makeStorage({
      co1: {
        list: vi.fn(() => ok([{ name: "a.pdf", id: "new" }]))
      },
      [LEGACY_PRIVATE_BUCKET]: {
        list: vi.fn(() =>
          ok([
            { name: "a.pdf", id: "old" },
            { name: "b.pdf", id: "legacy-only" }
          ])
        )
      }
    });

    const result = await listCompanyPrivateObjects({
      storage,
      companyId: "co1",
      prefix: "co1/docs"
    });

    expect(result.errors).toHaveLength(0);
    expect(result.data.map((f) => [f.name, f.id]).sort()).toEqual([
      ["a.pdf", "new"],
      ["b.pdf", "legacy-only"]
    ]);
  });

  it("still returns the healthy bucket's rows when the other errors", async () => {
    const storage = makeStorage({
      co1: { list: vi.fn(() => fail("bucket missing")) },
      [LEGACY_PRIVATE_BUCKET]: {
        list: vi.fn(() => ok([{ name: "b.pdf" }]))
      }
    });

    const result = await listCompanyPrivateObjects({
      storage,
      companyId: "co1",
      prefix: "co1/docs"
    });

    expect(result.data.map((f) => f.name)).toEqual(["b.pdf"]);
    expect(result.errors).toEqual([
      { bucket: "co1", error: { message: "bucket missing" } }
    ]);
  });
});

describe("removeCompanyPrivateObjects", () => {
  it("removes from both buckets and tolerates misses", async () => {
    const companyRemove = vi.fn(() => ok([]));
    const legacyRemove = vi.fn(() => ok([{ name: "a.pdf" }]));
    const storage = makeStorage({
      co1: { remove: companyRemove },
      [LEGACY_PRIVATE_BUCKET]: { remove: legacyRemove }
    });

    const result = await removeCompanyPrivateObjects({
      storage,
      companyId: "co1",
      objectPaths: ["co1/docs/a.pdf"]
    });

    expect(result.errors).toHaveLength(0);
    expect(companyRemove).toHaveBeenCalledWith(["co1/docs/a.pdf"]);
    expect(legacyRemove).toHaveBeenCalledWith(["co1/docs/a.pdf"]);
  });

  it("surfaces real failures", async () => {
    const storage = makeStorage({
      co1: { remove: vi.fn(() => fail("permission denied")) }
    });

    const result = await removeCompanyPrivateObjects({
      storage,
      companyId: "co1",
      objectPaths: ["co1/docs/a.pdf"]
    });

    expect(result.errors).toEqual([
      { bucket: "co1", error: { message: "permission denied" } }
    ]);
  });
});
