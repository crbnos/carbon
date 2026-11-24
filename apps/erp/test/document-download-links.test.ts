// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getPostgresClient } from "@carbon/database/client";
import { pageClaims } from "./page-claims";
import {
  DownloadTokenExpiredError,
  verifyDownloadToken
} from "@carbon/auth/download-token.server";
import { type Actor, createServiceContext } from "@carbon/api/service-fn.server";
import { getCompanyPrivateBucket } from "@carbon/files";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getDocumentDownloadUrl } from "../app/modules/documents/documents.server";
import {
  createItemDocumentUploadUrl,
  getItemDocumentDownloadUrl
} from "../app/modules/items/items.server";
import {
  createJobDocumentUploadUrl,
  getJobDocumentDownloadUrl
} from "../app/modules/production/production.server";
import {
  createSupplierInteractionDocumentUploadUrl,
  createSupplierInteractionLineDocumentUploadUrl,
  getSupplierInteractionDocumentDownloadUrl,
  getSupplierInteractionLineDocumentDownloadUrl
} from "../app/modules/purchasing/purchasing.server";
import {
  createOpportunityDocumentUploadUrl,
  createOpportunityLineDocumentUploadUrl,
  getOpportunityDocumentDownloadUrl,
  getOpportunityLineDocumentDownloadUrl
} from "../app/modules/sales/sales.server";
import { ERP_URL } from "../app/utils/path";

// No database: the caller's rows and the company bucket are in-memory fakes
// that keep their contents and apply the filters a read sends.

const COMPANY = "company-1";
const OTHER = "company-2";
const MODULES = ["documents", "parts", "production", "sales", "purchasing"];

type Row = Record<string, unknown>;

/** A caller's client that returns the rows its row-level security shows. */
function rowsClient(tables: Record<string, Row[]>) {
  return {
    from(table: string) {
      const filters: [string, unknown][] = [];
      const query = {
        select: () => query,
        eq(column: string, value: unknown) {
          filters.push([column, value]);
          return query;
        },
        maybeSingle: async () => ({
          data:
            (tables[table] ?? []).find((row) =>
              filters.every(([column, value]) => row[column] === value)
            ) ?? null,
          error: null
        })
      };
      return query;
    }
  };
}

/** Storage that holds the keys in `objects`, per bucket, and signs only those. */
function storageClient(objects: Map<string, Set<string>>) {
  return {
    storage: {
      from: (bucket: string) => ({
        createSignedUploadUrl: async (path: string) => ({
          data: { path, token: "upload", signedUrl: `https://storage.test/upload/${bucket}/${path}` },
          error: null
        }),
        createSignedUrl: async (path: string, expiresIn: number) =>
          objects.get(bucket)?.has(path)
            ? {
                data: {
                  signedUrl: `https://storage.test/sign/${bucket}/${path}?token=t&expires=${expiresIn}`
                },
                error: null
              }
            : { data: null, error: { statusCode: "404", message: "Object not found" } }
      })
    }
  };
}

const key = (views: string[]): Extract<Actor, { type: "apiKey" }> => ({
  type: "apiKey",
  createdBy: "key-creator",
  permissions: pageClaims(
    Object.fromEntries(
    MODULES.map((module) => [
      module,
      {
        view: views.includes(module) ? [COMPANY] : [],
        create: views.includes(module) ? [COMPANY] : [],
        update: [],
        delete: []
      }
    ])
  )
  )
});

/** Every item the item gates read is a Part, at the Postgres wire. */
const partsDatabase = (() => {
  const connection = {
    executeQuery: async () => ({
      rows: ["i", "item-1", "r-1"].map((id) => ({ id, type: "Part" }))
    }),
    // biome-ignore lint/correctness/useYield: never streamed
    streamQuery: async function* () {
      throw new Error("not streamed");
    }
  };
  const done = async () => undefined;
  class Driver {
    init = done;
    acquireConnection = async () => connection;
    beginTransaction = done;
    commitTransaction = done;
    rollbackTransaction = done;
    releaseConnection = done;
    destroy = done;
  }
  return getPostgresClient({} as never, Driver as never);
})();

function contextOf(
  actor: Actor,
  {
    rows = {},
    objects = new Map()
  }: { rows?: Record<string, Row[]>; objects?: Map<string, Set<string>> } = {}
) {
  const files = storageClient(objects);
  return createServiceContext({
    actor,
    company: { id: COMPANY, groupId: "group-1" },
    caller: { ...rowsClient(rows), ...files } as never,
    system: () => files as never,
    // The item gates read the item's type, which picks its page.
    pg: () => partsDatabase,
    kv: () => {
      throw new Error("No cache here");
    }
  });
}

const document = (id: string, companyId: string, path: string | null) => ({
  id,
  companyId,
  name: "Drawing.pdf",
  path
});

const rows = {
  document: [
    document("doc-1", COMPANY, `${COMPANY}/drawing.pdf`),
    document("doc-2", OTHER, `${OTHER}/drawing.pdf`),
    document("doc-3", COMPANY, null)
  ]
};

type Call = (ctx: unknown, input: unknown) => Promise<{
  data: unknown;
  error: { category: string } | null;
}>;

describe("a caller without access is refused", () => {
  it.each([
    ["documents", getDocumentDownloadUrl, { documentId: "doc-1" }],
    ["parts", getItemDocumentDownloadUrl, { itemId: "i", name: "a.pdf" }],
    ["production", getJobDocumentDownloadUrl, { jobId: "j", name: "a.pdf" }],
    ["sales", getOpportunityDocumentDownloadUrl, { opportunityId: "o", name: "a.pdf" }],
    ["sales", getOpportunityLineDocumentDownloadUrl, { lineId: "l", name: "a.pdf" }],
    ["purchasing", getSupplierInteractionDocumentDownloadUrl, { interactionId: "s", name: "a.pdf" }],
    ["purchasing", getSupplierInteractionLineDocumentDownloadUrl, { lineId: "l", name: "a.pdf" }]
  ] as const)("refuses a key without the %s view scope", async (module, op, input) => {
    const others = MODULES.filter((m) => m !== module);
    const { data, error } = await (op as never as Call)(
      contextOf(key(others), { rows }),
      input
    );
    expect(data).toBeNull();
    expect(error?.category).toBe("forbidden");
  });

  it("refuses a document the caller's row-level security hides", async () => {
    const { data, error } = await getDocumentDownloadUrl(
      contextOf(key(["documents"]), { rows: { document: [] } }),
      { documentId: "doc-1" }
    );
    expect(data).toBeNull();
    expect(error?.category).toBe("notFound");
  });

  it("refuses another company's document although the caller's client returns it", async () => {
    const { data, error } = await getDocumentDownloadUrl(
      contextOf(key(["documents"]), { rows }),
      { documentId: "doc-2" }
    );
    expect(data).toBeNull();
    expect(error?.category).toBe("notFound");
  });
});

describe("the document link", () => {
  afterEach(() => vi.useRealTimers());

  it("names the caller's company, the document and the user the call is recorded under", async () => {
    const { data, error } = await getDocumentDownloadUrl(
      contextOf(key(["documents"]), { rows }),
      { documentId: "doc-1" }
    );
    expect(error).toBeNull();
    const prefix = `${ERP_URL}/download/`;
    expect(data?.url.startsWith(prefix)).toBe(true);
    expect(data).toEqual({
      documentId: "doc-1",
      name: "Drawing.pdf",
      url: data?.url,
      expiresIn: 3600
    });
    expect(await verifyDownloadToken(data!.url.slice(prefix.length))).toEqual({
      userId: "key-creator",
      companyId: COMPANY,
      documentId: "doc-1"
    });
  });

  it("stops working an hour after it is made", async () => {
    vi.useFakeTimers({ now: Date.parse("2026-11-18T09:00:00Z") });
    const { data } = await getDocumentDownloadUrl(
      contextOf(key(["documents"]), { rows }),
      { documentId: "doc-1" }
    );
    const token = data!.url.slice(`${ERP_URL}/download/`.length);

    vi.setSystemTime(Date.parse("2026-11-18T10:01:00Z"));
    await expect(verifyDownloadToken(token)).rejects.toBeInstanceOf(
      DownloadTokenExpiredError
    );
  });

  it("is not made for a document with no file", async () => {
    const { data, error } = await getDocumentDownloadUrl(
      contextOf(key(["documents"]), { rows }),
      { documentId: "doc-3" }
    );
    expect(data).toBeNull();
    expect(error?.category).toBe("notFound");
  });
});

describe("record file links", () => {
  const bucket = getCompanyPrivateBucket(COMPANY);

  it("signs, for an hour, the key the upload URL gave the same name", async () => {
    const objects = new Map([[bucket, new Set<string>()]]);
    const ctx = contextOf(key(["parts"]), { objects });
    const input = { itemId: "item-1", name: "Bracket rev B.pdf" };

    const upload = await createItemDocumentUploadUrl(ctx, input);
    const uploaded = (upload.data as { path: string }).path;
    objects.get(bucket)!.add(uploaded);

    const { data, error } = await getItemDocumentDownloadUrl(ctx, input);
    expect(error).toBeNull();
    expect(data).toEqual({
      path: uploaded,
      signedUrl:
        "https://storage.test/sign/company-1/company-1/parts/item-1/Bracket%20rev%20B.pdf?token=t&expires=3600&download=Bracket+rev+B.pdf",
      expiresIn: 3600
    });
    expect(uploaded).toBe("company-1/parts/item-1/Bracket rev B.pdf");
  });

  // A download that signs another folder than its upload wrote passes every
  // other case here, since the fake bucket only answers for keys it holds.
  it.each([
    ["items", "parts", createItemDocumentUploadUrl, getItemDocumentDownloadUrl, { itemId: "r-1" }],
    ["production", "production", createJobDocumentUploadUrl, getJobDocumentDownloadUrl, { jobId: "r-1" }],
    ["sales opportunity", "sales", createOpportunityDocumentUploadUrl, getOpportunityDocumentDownloadUrl, { opportunityId: "r-1" }],
    ["sales opportunity line", "sales", createOpportunityLineDocumentUploadUrl, getOpportunityLineDocumentDownloadUrl, { lineId: "r-1" }],
    ["purchasing interaction", "purchasing", createSupplierInteractionDocumentUploadUrl, getSupplierInteractionDocumentDownloadUrl, { interactionId: "r-1" }],
    ["purchasing interaction line", "purchasing", createSupplierInteractionLineDocumentUploadUrl, getSupplierInteractionLineDocumentDownloadUrl, { lineId: "r-1" }]
  ] as const)("%s: signs the key its upload URL wrote", async (_name, scope, upload, download, record) => {
    const objects = new Map([[bucket, new Set<string>()]]);
    const ctx = contextOf(key([scope]), { objects });
    const input = { ...record, name: "Spec sheet.pdf" };

    const uploaded = ((await (upload as any)(ctx, input)).data as { path: string }).path;
    objects.get(bucket)!.add(uploaded);

    const { data, error } = await (download as any)(ctx, input);
    expect(error).toBeNull();
    expect(data?.path).toBe(uploaded);
  });

  it("refuses a name that climbs out of the record's folder", async () => {
    const { data, error } = await getItemDocumentDownloadUrl(
      contextOf(key(["parts"])),
      { itemId: "item-1", name: "../../item-2/secret.pdf" }
    );
    expect(data).toBeNull();
    expect(error?.category).toBe("validation");
  });

  it("refuses a file that is not there", async () => {
    const { data, error } = await getJobDocumentDownloadUrl(
      contextOf(key(["production"]), { objects: new Map([[bucket, new Set()]]) }),
      { jobId: "job-1", name: "missing.pdf" }
    );
    expect(data).toBeNull();
    expect(error?.category).toBe("notFound");
  });
});
