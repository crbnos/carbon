// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { removeCompanyFiles } from "./purge-company";

/** A storage client over in-memory buckets of flat `folder/file` paths. */
function fakeStorage(
  buckets: Record<string, string[]>,
  { failRemove = false }: { failRemove?: boolean } = {}
) {
  const calls: string[] = [];
  const storage = {
    from: (bucket: string) => ({
      list: async (prefix: string) => {
        const under = (buckets[bucket] ?? []).filter(
          (path) => !prefix || path.startsWith(`${prefix}/`)
        );
        const names = new Map<string, boolean>();
        for (const path of under) {
          const [head, ...rest] = path
            .slice(prefix ? prefix.length + 1 : 0)
            .split("/");
          names.set(head!, rest.length === 0);
        }
        return {
          data: [...names].map(([name, isFile]) => ({
            name,
            id: isFile ? name : null,
            metadata: null
          })),
          error: null
        };
      },
      remove: async (paths: string[]) => {
        calls.push(`remove ${bucket} ${paths.length}`);
        if (failRemove) return { error: new Error("timeout") };
        buckets[bucket] = buckets[bucket]!.filter((p) => !paths.includes(p));
        return { error: null };
      }
    }),
    deleteBucket: async (bucket: string) => {
      calls.push(`deleteBucket ${bucket}`);
      if (!(bucket in buckets)) return { error: new Error("Bucket not found") };
      if (buckets[bucket]!.length > 0)
        return {
          error: new Error("The bucket you tried to delete is not empty")
        };
      delete buckets[bucket];
      return { error: null };
    },
    emptyBucket: async () => {
      throw new Error("emptyBucket only queues the deletes; do not use it");
    }
  };
  return { serviceRole: { storage } as never, buckets, calls };
}

describe("removeCompanyFiles", () => {
  it("drains the company bucket before deleting it, and the legacy folder", async () => {
    const { serviceRole, buckets } = fakeStorage({
      co1: ["parts/a.png", "job/j1/b.pdf"],
      private: ["co1/docs/c.pdf", "co12/docs/keep.pdf"]
    });
    expect(await removeCompanyFiles(serviceRole, "co1")).toEqual([]);
    expect(buckets).toEqual({ private: ["co12/docs/keep.pdf"] });
  });

  it("treats a bucket that is already gone as done", async () => {
    const { serviceRole } = fakeStorage({ private: [] });
    expect(await removeCompanyFiles(serviceRole, "co1")).toEqual([]);
  });

  it("reports each part that failed, and leaves the bucket", async () => {
    const { serviceRole, calls } = fakeStorage(
      { co1: ["a.png"], private: ["co1/b.pdf"] },
      { failRemove: true }
    );
    const failures = await removeCompanyFiles(serviceRole, "co1");
    expect(failures.map((f) => f.part)).toEqual([
      "company bucket",
      "legacy private files"
    ]);
    expect(calls).not.toContain("deleteBucket co1");
  });
});
