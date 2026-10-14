// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it, vi } from "vitest";
import { getDefaultAttachmentsForPO } from "~/modules/purchasing/purchasing.service";

// The service module's message descriptors are compiled by the Lingui Vite
// plugin, which this test environment does not run.
vi.mock("@lingui/core/macro", () => ({
  msg: (strings: TemplateStringsArray) => strings.join("")
}));

const prefix = "co1/default-attachments";

// A storage client whose company bucket holds `folders` (prefix → sub-folder
// names) and `files` (prefix → file names); the legacy bucket is empty.
function fakeClient(
  folders: Record<string, string[]>,
  files: Record<string, string[]>,
  failing: string[] = []
) {
  const listed: string[] = [];
  const listV2 = (bucket: string) =>
    vi.fn(async ({ prefix: path }: { prefix: string }) => {
      if (bucket === "co1") listed.push(path);
      if (failing.includes(path)) {
        return { data: null, error: { message: "storage down" } };
      }
      if (bucket !== "co1") {
        return { data: { hasNext: false, folders: [], objects: [] }, error: null };
      }
      const key = path.replace(/\/$/, "");
      return {
        data: {
          hasNext: false,
          folders: (folders[key] ?? []).map((name) => ({
            key: `${key}/${name}`,
            name: `${key}/${name}/`
          })),
          objects: (files[key] ?? []).map((name) => ({
            key: `${key}/${name}`,
            name: `${key}/${name}`,
            id: `${key}/${name}`,
            metadata: { size: 2048 }
          }))
        },
        error: null
      };
    });
  const buckets = new Map<string, ReturnType<typeof listV2>>();
  const client = {
    storage: {
      from: (bucket: string) => {
        if (!buckets.has(bucket)) buckets.set(bucket, listV2(bucket));
        return { listV2: buckets.get(bucket) };
      }
    }
  };
  return { client: client as never, listed };
}

describe("getDefaultAttachmentsForPO", () => {
  it("lists only the items that have default attachments", async () => {
    const { client, listed } = fakeClient(
      { [`${prefix}/item`]: ["i2"] },
      { [`${prefix}/item/i2`]: ["spec.pdf"] }
    );

    const attachments = await getDefaultAttachmentsForPO(client, {
      companyId: "co1",
      supplierId: "s1",
      itemIds: ["i1", "i2", "i3"]
    });

    expect(listed.sort()).toEqual(
      [
        `${prefix}/company/`,
        `${prefix}/item/`,
        `${prefix}/item/i2/`,
        `${prefix}/supplier/s1/`
      ].sort()
    );
    expect(attachments).toEqual([
      {
        source: "item",
        name: "spec.pdf",
        size: 2,
        path: `${prefix}/item/i2/spec.pdf`
      }
    ]);
  });

  it("checks every item when the item folder cannot be listed", async () => {
    const { client, listed } = fakeClient({}, {}, [`${prefix}/item/`]);

    await getDefaultAttachmentsForPO(client, {
      companyId: "co1",
      supplierId: null,
      itemIds: ["i1", "i2"]
    });

    expect(listed).toEqual(
      expect.arrayContaining([`${prefix}/item/i1/`, `${prefix}/item/i2/`])
    );
  });
});
