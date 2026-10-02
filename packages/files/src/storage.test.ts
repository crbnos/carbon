// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { StorageClient } from "@supabase/storage-js";
import { describe, expect, it, vi } from "vitest";
import {
  getCompanyPrivateBucket,
  hasCompanyPrivateObjectPathPrefix,
  isStorageNotFound,
  isUnsafeStoragePath,
  LEGACY_PRIVATE_BUCKET,
  normalizeStorageSegment,
  safeStorageFileName,
  storage,
  storageErrorStatus
} from "./storage";

const ok = <T>(data: T) => Promise.resolve({ data, error: null });
const fail = (message: string) =>
  Promise.resolve({ data: null, error: { message } });

type Bucket = ReturnType<StorageClient["from"]>;

// A fake `client.storage`: every bucket method misses unless overridden.
// Stubs are loosely typed on purpose: they return the minimum shape a test needs.
const makeClient = (buckets: Record<string, Record<string, unknown>>) => ({
  storage: {
    from: (bucket: string) =>
      ({
        upload: vi.fn(() => ok({ path: "p" })),
        update: vi.fn(() => ok({ path: "p" })),
        uploadToSignedUrl: vi.fn(() => ok({ path: "p" })),
        move: vi.fn(() => ok({ message: "ok" })),
        copy: vi.fn(() => ok({ path: "p" })),
        createSignedUploadUrl: vi.fn(() => ok({ signedUrl: "u" })),
        exists: vi.fn(() => fail("not found")),
        info: vi.fn(() => fail("not found")),
        download: vi.fn(() => fail("not found")),
        createSignedUrl: vi.fn(() => fail("not found")),
        listV2: vi.fn(() => ok({ hasNext: false, folders: [], objects: [] })),
        remove: vi.fn(() => ok([])),
        ...buckets[bucket]
      }) as unknown as Bucket
  } as unknown as StorageClient
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

describe("isUnsafeStoragePath", () => {
  it.each([
    ["a plain key", "co1/parts/item1/drawing.pdf"],
    ["an encoded key (spaces)", "co1/parts/item1/My%20Drawing.pdf"],
    ["a decoded key with spaces", "co1/parts/item1/My Drawing.pdf"],
    ["dots inside a segment", "co1/parts/item1/a..b.v2.step"],
    ["a trailing slash (list prefix)", "co1/parts/"],
    ["a CAD raw", "co1/models/abc123/raw.step.zst"]
  ])("allows %s", (_, path) => {
    expect(isUnsafeStoragePath(path)).toBe(false);
  });

  it.each([
    ["a parent segment", "co1/../co2/a.pdf"],
    ["a current segment", "co1/./a.pdf"],
    ["a leading parent segment", "../co2/a.pdf"],
    ["a trailing parent segment", "co1/.."],
    ["encoded parent segment", "co1/%2e%2e/co2/a.pdf"],
    ["encoded parent segment, upper case", "co1/%2E%2E/co2/a.pdf"],
    ["half-encoded parent segment", "co1/.%2e/co2/a.pdf"],
    ["encoded current segment", "co1/%2e/a.pdf"],
    ["encoded slash forming a parent segment", "co1/..%2fco2/a.pdf"],
    ["double-encoded parent segment", "co1/%252e%252e/co2/a.pdf"],
    ["double-encoded slash", "co1/..%252fco2/a.pdf"],
    ["triple-encoded parent segment", "co1/%25252e%25252e/co2/a.pdf"],
    ["a backslash", "co1\\..\\co2\\a.pdf"],
    ["an encoded backslash", "co1/..%5c..%5cco2/a.pdf"],
    ["a double-encoded backslash", "co1/..%255cco2/a.pdf"],
    ["a query", "co1/a.pdf?download=1"],
    ["an encoded query", "co1/a.pdf%3Fx"],
    ["a fragment", "co1/a.pdf#x"],
    ["a double-encoded fragment", "co1/a.pdf%2523x"],
    ["a tab", "co1/a\t.pdf"],
    ["a newline", "co1/.\n./co2/a.pdf"],
    ["a NUL", "co1/a\u0000.pdf"],
    ["DEL", "co1/a\u007f.pdf"],
    ["an encoded tab", "co1/.%09./co2/a.pdf"],
    ["an encoded NUL", "co1/a%00.pdf"],
    ["a double-encoded newline", "co1/a%250a.pdf"],
    ["a malformed escape", "co1/a%zz.pdf"],
    ["a malformed escape one layer down", "co1/a%25zz.pdf"]
  ])("refuses %s", (_, path) => {
    expect(isUnsafeStoragePath(path)).toBe(true);
  });

  it("refuses a key that keeps decoding past the pass limit", () => {
    let path = "co1/../co2/a.pdf";
    for (let i = 0; i < 8; i++) path = encodeURIComponent(path);
    expect(isUnsafeStoragePath(path)).toBe(true);
  });
});

describe("safeStorageFileName", () => {
  it("keeps an ordinary file name", () => {
    expect(safeStorageFileName("PO 1234.pdf")).toBe("PO 1234.pdf");
    expect(safeStorageFileName("  spaced.pdf  ")).toBe("spaced.pdf");
  });

  it("keeps only the basename", () => {
    expect(safeStorageFileName("../../co2/evil.pdf")).toBe("evil.pdf");
    expect(safeStorageFileName("..\\..\\co2\\evil.pdf")).toBe("evil.pdf");
  });

  it.each([
    ["a fragment", "Drawing #3.pdf", "Drawing 3.pdf"],
    ["a query", "what?.pdf", "what.pdf"],
    ["a percent sign", "50%.pdf", "50.pdf"],
    ["an encoded dot-dot", "%2e%2e", "2e2e"]
  ])("keeps a name with %s usable", (_, name, safe) => {
    expect(safeStorageFileName(name)).toBe(safe);
  });

  it.each([
    ["an empty name", ""],
    ["a trailing slash", "dir/"],
    ["a dot", "."],
    ["a dot-dot", ".."],
    ["a control character", "a\u0001.pdf"]
  ])("refuses %s", (_, name) => {
    expect(safeStorageFileName(name)).toBeNull();
  });
});

describe("storage(client).from", () => {
  it("is the plain supabase bucket", () => {
    const client = makeClient({});
    const spy = vi.spyOn(client.storage, "from");
    storage(client).from("public");
    expect(spy).toHaveBeenCalledWith("public");
  });
});

describe("storage(client).company", () => {
  it("throws on an empty companyId", () => {
    expect(() => storage(makeClient({})).company("")).toThrow();
  });

  describe("writes go to the company bucket only", () => {
    it.each([
      ["upload", (b: Bucket) => b.upload("co1/docs/a.pdf", new Blob())],
      // A `#` only truncates the key inside the company prefix, as it always has.
      [
        "upload",
        (b: Bucket) => b.upload("co1/docs/Drawing #3.pdf", new Blob())
      ],
      ["update", (b: Bucket) => b.update("co1/docs/a.pdf", new Blob())],
      [
        "uploadToSignedUrl",
        (b: Bucket) => b.uploadToSignedUrl("co1/docs/a.pdf", "tok", new Blob())
      ],
      [
        "createSignedUploadUrl",
        (b: Bucket) => b.createSignedUploadUrl("co1/docs/a.pdf")
      ]
    ] as const)("%s", async (method, call) => {
      const legacy = vi.fn(() => ok({ path: "leak" }));
      const client = makeClient({
        [LEGACY_PRIVATE_BUCKET]: { [method]: legacy }
      });
      const result = await call(
        storage(client).company("co1") as unknown as Bucket
      );
      expect(result.error).toBeNull();
      expect(legacy).not.toHaveBeenCalled();
    });

    it.each(["move", "copy"] as const)("%s", async (method) => {
      const legacy = vi.fn(() => ok({ path: "leak" }));
      const client = makeClient({
        [LEGACY_PRIVATE_BUCKET]: { [method]: legacy }
      });
      const result = await storage(client)
        .company("co1")
        [method]("co1/a.pdf", "co1/b.pdf");
      expect(result.error).toBeNull();
      expect(legacy).not.toHaveBeenCalled();
    });
  });

  describe("refuses a key outside the company prefix without touching storage", () => {
    const client = makeClient({
      co1: {
        download: vi.fn(() => ok(new Blob())),
        upload: vi.fn(() => ok({ path: "leak" }))
      },
      [LEGACY_PRIVATE_BUCKET]: {
        download: vi.fn(() => ok(new Blob())),
        remove: vi.fn(() => ok([{ name: "leak" }]))
      }
    });
    const bucket = storage(client).company("co1");
    const touched = () =>
      [client.storage.from("co1"), client.storage.from(LEGACY_PRIVATE_BUCKET)]
        .flatMap((b) => Object.values(b))
        .some((fn) => (fn as ReturnType<typeof vi.fn>).mock?.calls.length);

    it.each([
      ["upload", () => bucket.upload("co2/a.pdf", new Blob())],
      ["update", () => bucket.update("co2/a.pdf", new Blob())],
      [
        "uploadToSignedUrl",
        () => bucket.uploadToSignedUrl("co2/a.pdf", "tok", new Blob())
      ],
      ["move", () => bucket.move("co1/a.pdf", "co2/a.pdf")],
      ["copy", () => bucket.copy("co2/a.pdf", "co1/a.pdf")],
      [
        "createSignedUploadUrl",
        () => bucket.createSignedUploadUrl("co2/a.pdf")
      ],
      ["exists", () => bucket.exists("co2/a.pdf")],
      ["info", () => bucket.info("co2/a.pdf")],
      ["download", () => bucket.download("co2/a.pdf")],
      ["createSignedUrl", () => bucket.createSignedUrl("co2/a.pdf", 60)],
      ["list", () => bucket.list("co2/docs")],
      ["remove", () => bucket.remove(["co1/a.pdf", "co2/a.pdf"])],
      ["a prefix-lookalike", () => bucket.download("co12/a.pdf")],
      ["an empty key", () => bucket.download("")],
      ["a parent segment", () => bucket.download("co1/../co2/a.pdf")],
      ["an encoded parent segment", () => bucket.download("co1/%2e%2e/co2/a")],
      [
        "a double-encoded parent segment",
        () => bucket.upload("co1/%252e%252e/co2/a.pdf", new Blob())
      ],
      ["a backslash", () => bucket.remove(["co1\\..\\co2\\a.pdf"])],
      ["a control character", () => bucket.createSignedUrl("co1/a\n.pdf", 60)],
      ["a list prefix that climbs out", () => bucket.list("co1/..")]
    ])("%s", async (_, call) => {
      const result = await call();
      // `exists` answers false rather than null — supabase's own shape.
      expect(result.data).toBeFalsy();
      expect(result.error?.message).toMatch(
        /outside the "co1\/" storage prefix/
      );
      expect(touched()).toBe(false);
    });

    it.each([
      ["a traversal before a query", () => bucket.download("co1/../co2/a?x")],
      ["a traversal before a fragment", () => bucket.download("co1/..#/a")]
    ])("%s", async (_, call) => {
      const result = await call();
      expect(result.data).toBeFalsy();
      expect(result.error?.message).toMatch(
        /outside the "co1\/" storage prefix/
      );
      expect(touched()).toBe(false);
    });

    it("names only the offending keys", async () => {
      const { error } = await bucket.remove(["co1/a.pdf", "co2/a.pdf"]);
      expect(error?.message).toBe(
        'co2/a.pdf is outside the "co1/" storage prefix'
      );
    });
  });

  describe("reads fall back to the legacy bucket", () => {
    it.each([
      ["exists", (b: Bucket) => b.exists("co1/a.pdf"), true],
      ["info", (b: Bucket) => b.info("co1/a.pdf"), { name: "a.pdf" }],
      ["download", (b: Bucket) => b.download("co1/a.pdf"), new Blob(["x"])],
      [
        "createSignedUrl",
        (b: Bucket) => b.createSignedUrl("co1/a.pdf", 60),
        { signedUrl: "https://x/y" }
      ]
    ] as const)("%s", async (method, call, hit) => {
      const legacyMiss = vi.fn(() => fail("legacy miss"));

      // Company hit: legacy never touched.
      let client = makeClient({
        co1: { [method]: vi.fn(() => ok(hit)) },
        [LEGACY_PRIVATE_BUCKET]: { [method]: legacyMiss }
      });
      let result = await call(
        storage(client).company("co1") as unknown as Bucket
      );
      expect(result.data).toBe(hit);
      expect(legacyMiss).not.toHaveBeenCalled();

      // Company miss, legacy hit.
      client = makeClient({
        [LEGACY_PRIVATE_BUCKET]: { [method]: vi.fn(() => ok(hit)) }
      });
      result = await call(storage(client).company("co1") as unknown as Bucket);
      expect(result.data).toBe(hit);
      expect(result.error).toBeNull();

      // Both miss: the company bucket's error is reported.
      client = makeClient({
        co1: { [method]: vi.fn(() => fail("company miss")) },
        [LEGACY_PRIVATE_BUCKET]: { [method]: legacyMiss }
      });
      result = await call(storage(client).company("co1") as unknown as Bucket);
      expect(result.data).toBeNull();
      expect(result.error?.message).toBe("company miss");
    });

    it("download forwards transform options to both buckets", async () => {
      const companyDownload = vi.fn(() => fail("miss"));
      const legacyDownload = vi.fn(() => ok(new Blob()));
      const client = makeClient({
        co1: { download: companyDownload },
        [LEGACY_PRIVATE_BUCKET]: { download: legacyDownload }
      });
      const options = { transform: { quality: 85 } };
      await storage(client).company("co1").download("co1/a.heic", options);
      expect(companyDownload).toHaveBeenCalledWith("co1/a.heic", options);
      expect(legacyDownload).toHaveBeenCalledWith("co1/a.heic", options);
    });
  });

  describe("list", () => {
    const file = (key: string, id: string) => ({
      key,
      name: `co1/docs/${key}`,
      id,
      metadata: { size: 1 }
    });
    // The paged endpoint's folder shape: no id, no metadata.
    const folder = (key: string) => ({ key, name: `co1/docs/${key}/` });

    it("returns the folder's entries by their own names, sorted", async () => {
      const listV2 = vi.fn(() =>
        ok({
          hasNext: false,
          folders: [folder("zeta"), folder("alpha")],
          objects: [file("b.pdf", "2"), file("a.pdf", "1")]
        })
      );
      const legacy = vi.fn(() =>
        ok({ hasNext: false, folders: [], objects: [] })
      );
      const client = makeClient({
        co1: { listV2 },
        [LEGACY_PRIVATE_BUCKET]: { listV2: legacy }
      });

      const { data, error } = await storage(client)
        .company("co1")
        .list("co1/docs");

      expect(error).toBeNull();
      expect(data?.map((f) => [f.name, f.id])).toEqual([
        ["a.pdf", "1"],
        ["alpha", null],
        ["b.pdf", "2"],
        ["zeta", null]
      ]);
      expect(data?.[0]?.metadata).toEqual({ size: 1 });
      expect(data?.[1]).toEqual({
        key: "alpha",
        name: "alpha",
        id: null,
        updated_at: null,
        created_at: null,
        last_accessed_at: null,
        metadata: null
      });
    });

    it("unions both buckets with the company bucket winning ties", async () => {
      const own = vi.fn(() =>
        ok({ hasNext: false, folders: [], objects: [file("b.pdf", "own")] })
      );
      const legacy = vi.fn(() =>
        ok({
          hasNext: false,
          folders: [],
          objects: [file("b.pdf", "legacy"), file("a.pdf", "legacy")]
        })
      );
      const client = makeClient({
        co1: { listV2: own },
        [LEGACY_PRIVATE_BUCKET]: { listV2: legacy }
      });

      const { data } = await storage(client).company("co1").list("co1/docs");

      expect(data?.map((f) => [f.name, f.id])).toEqual([
        ["a.pdf", "legacy"],
        ["b.pdf", "own"]
      ]);
    });

    it("still returns the healthy bucket's rows when the other errors", async () => {
      const client = makeClient({
        co1: { listV2: vi.fn(() => fail("bucket not found")) },
        [LEGACY_PRIVATE_BUCKET]: {
          listV2: vi.fn(() =>
            ok({ hasNext: false, folders: [], objects: [file("a.pdf", "1")] })
          )
        }
      });

      const { data, error } = await storage(client)
        .company("co1")
        .list("co1/docs");

      expect(error).toBeNull();
      expect(data?.map((f) => f.name)).toEqual(["a.pdf"]);
    });

    it("lists what is inside the folder, with or without a trailing slash", async () => {
      for (const path of ["co1/docs", "co1/docs/"]) {
        const listV2 = vi.fn(() =>
          ok({ hasNext: false, folders: [], objects: [] })
        );
        await storage(makeClient({ co1: { listV2 } }))
          .company("co1")
          .list(path);
        expect(listV2).toHaveBeenCalledWith({
          prefix: "co1/docs/",
          with_delimiter: true,
          cursor: undefined
        });
      }
    });

    it("reads every page", async () => {
      const pages = [
        {
          hasNext: true,
          nextCursor: "c1",
          folders: [],
          objects: [file("a.pdf", "1")]
        },
        {
          hasNext: true,
          nextCursor: "c2",
          folders: [],
          objects: [file("b.pdf", "2")]
        },
        { hasNext: false, folders: [], objects: [file("c.pdf", "3")] }
      ];
      const listV2 = vi.fn((options: { cursor?: string }) =>
        ok(pages[["c1", "c2"].indexOf(options.cursor ?? "") + 1])
      );

      const { data } = await storage(makeClient({ co1: { listV2 } }))
        .company("co1")
        .list("co1/docs");

      expect(data?.map((f) => f.name)).toEqual(["a.pdf", "b.pdf", "c.pdf"]);
    });

    it.each([
      ["repeats the cursor", "c1"],
      ["gives no cursor", undefined]
    ])("fails when a page promises more and %s", async (_, nextCursor) => {
      const listV2 = vi.fn(() =>
        ok({
          hasNext: true,
          nextCursor,
          folders: [],
          objects: [file("a.pdf", "1")]
        })
      );

      const { data, error } = await storage(
        makeClient({ co1: { listV2 }, private: { listV2 } })
      )
        .company("co1")
        .list("co1/docs");

      expect(data).toBeNull();
      expect(error?.message).toContain("did not advance");
      expect(listV2.mock.calls.length).toBeLessThanOrEqual(4);
    });

    it("drops a bucket whose later page fails instead of keeping part of it", async () => {
      const listV2 = vi.fn((options: { cursor?: string }) =>
        options.cursor
          ? fail("storage down")
          : ok({
              hasNext: true,
              nextCursor: "c1",
              folders: [],
              objects: [file("a.pdf", "1")]
            })
      );

      const { data, error } = await storage(makeClient({ co1: { listV2 } }))
        .company("co1")
        .list("co1/docs");

      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("reports the company error when both buckets fail", async () => {
      const client = makeClient({
        co1: { listV2: vi.fn(() => fail("company down")) },
        [LEGACY_PRIVATE_BUCKET]: { listV2: vi.fn(() => fail("legacy down")) }
      });

      const { data, error } = await storage(client)
        .company("co1")
        .list("co1/docs");

      expect(data).toBeNull();
      expect(error?.message).toBe("company down");
    });
  });

  describe("remove", () => {
    it("removes from both buckets and tolerates misses", async () => {
      const companyRemove = vi.fn(() => ok([]));
      const legacyRemove = vi.fn(() => ok([{ name: "a.pdf" }]));
      const client = makeClient({
        co1: { remove: companyRemove },
        [LEGACY_PRIVATE_BUCKET]: { remove: legacyRemove }
      });
      const { data, error } = await storage(client)
        .company("co1")
        .remove(["co1/docs/a.pdf"]);
      expect(error).toBeNull();
      expect(data).toEqual([{ name: "a.pdf" }]);
      expect(companyRemove).toHaveBeenCalledWith(["co1/docs/a.pdf"]);
      expect(legacyRemove).toHaveBeenCalledWith(["co1/docs/a.pdf"]);
    });

    it("surfaces a failure on either bucket", async () => {
      const client = makeClient({
        [LEGACY_PRIVATE_BUCKET]: {
          remove: vi.fn(() => fail("permission denied"))
        }
      });
      const { data, error } = await storage(client)
        .company("co1")
        .remove(["co1/docs/a.pdf"]);
      expect(data).toBeNull();
      expect(error?.message).toBe("permission denied");
    });
  });
});

describe("move falls back to a cross-bucket move out of the legacy bucket", () => {
  it("moves within the company bucket when the file is already there", async () => {
    const legacyMove = vi.fn(() => ok({ message: "legacy" }));
    const client = makeClient({
      co1: { move: vi.fn(() => ok({ message: "company" })) },
      [LEGACY_PRIVATE_BUCKET]: { move: legacyMove }
    });

    const result = await storage(client)
      .company("co1")
      .move("co1/a.pdf", "co1/b.pdf");

    expect(result.data).toEqual({ message: "company" });
    expect(legacyMove).not.toHaveBeenCalled();
  });

  // A file uploaded before the per-company copy ran is only in the legacy
  // bucket, so the company-bucket move misses and the retry must carry it
  // across in one operation rather than leaving the drag broken.
  it("retries out of the legacy bucket into the company bucket on a miss", async () => {
    const legacyMove = vi.fn(() => ok({ message: "legacy" }));
    const client = makeClient({
      co1: { move: vi.fn(() => fail("not found")) },
      [LEGACY_PRIVATE_BUCKET]: { move: legacyMove }
    });

    const result = await storage(client)
      .company("co1")
      .move("co1/a.pdf", "co1/b.pdf");

    expect(result.data).toEqual({ message: "legacy" });
    expect(legacyMove).toHaveBeenCalledWith("co1/a.pdf", "co1/b.pdf", {
      destinationBucket: "co1"
    });
  });

  it("reports the company bucket's error when both buckets miss", async () => {
    const client = makeClient({
      co1: { move: vi.fn(() => fail("company miss")) },
      [LEGACY_PRIVATE_BUCKET]: { move: vi.fn(() => fail("legacy miss")) }
    });

    const result = await storage(client)
      .company("co1")
      .move("co1/a.pdf", "co1/b.pdf");

    expect(result.error).toEqual({ message: "company miss" });
  });

  it("refuses a key outside the company prefix without touching storage", async () => {
    const companyMove = vi.fn(() => ok({ message: "company" }));
    const client = makeClient({ co1: { move: companyMove } });

    const result = await storage(client)
      .company("co1")
      .move("co1/a.pdf", "co2/b.pdf");

    expect(result.error).toBeTruthy();
    expect(companyMove).not.toHaveBeenCalled();
  });
});

describe("storageErrorStatus", () => {
  it("reads the status off a download's wrapped response", async () => {
    const { StorageUnknownError } = await import("@supabase/storage-js");
    const error = new StorageUnknownError(
      "{}",
      new Response(null, { status: 400 })
    );
    expect(storageErrorStatus(error)).toBe(400);
  });

  it("reads an API error's own status", async () => {
    const { StorageApiError } = await import("@supabase/storage-js");
    expect(storageErrorStatus(new StorageApiError("nope", 404, "404"))).toBe(
      404
    );
  });

  it("is undefined when there is no status", () => {
    expect(storageErrorStatus(new Error("offline"))).toBeUndefined();
    expect(storageErrorStatus(null)).toBeUndefined();
  });
});

describe("isStorageNotFound", () => {
  // The shapes local storage actually returns from download(): HTTP 400 with
  // the real code in a body download() leaves unread.
  const downloadError = async (status: number, body?: unknown) => {
    const { StorageUnknownError } = await import("@supabase/storage-js");
    return new StorageUnknownError(
      "{}",
      new Response(body === undefined ? null : JSON.stringify(body), {
        status
      })
    );
  };

  it("treats a 400 whose body says 404 as a miss (object or bucket)", async () => {
    for (const error of ["not_found", "Bucket not found"]) {
      expect(
        await isStorageNotFound(
          await downloadError(400, { statusCode: "404", error })
        )
      ).toBe(true);
    }
  });

  it("treats a plain 404 as a miss", async () => {
    expect(await isStorageNotFound(await downloadError(404))).toBe(true);
    const { StorageApiError } = await import("@supabase/storage-js");
    expect(
      await isStorageNotFound(new StorageApiError("gone", 400, "404"))
    ).toBe(true);
  });

  it("does not treat an invalid key or request (400) as a miss", async () => {
    expect(
      await isStorageNotFound(
        await downloadError(400, { statusCode: "400", error: "InvalidKey" })
      )
    ).toBe(false);
    expect(await isStorageNotFound(await downloadError(400))).toBe(false);
  });

  it("does not treat server, auth or status-less errors as a miss", async () => {
    for (const status of [401, 403, 500, 503]) {
      expect(await isStorageNotFound(await downloadError(status))).toBe(false);
    }
    expect(await isStorageNotFound(new Error("offline"))).toBe(false);
    expect(await isStorageNotFound(null)).toBe(false);
  });
});
