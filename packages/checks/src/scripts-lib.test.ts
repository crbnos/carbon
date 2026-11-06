// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The root `scripts/lib` helpers belong to no package. They are tested here
// because this package's tests never cache, so an edit under scripts/ is seen.
import { describe, expect, it } from "vitest";
import {
  __setDbTypesContentForTest,
  getDbTableTypeFields
} from "../../../scripts/lib/db-types";
import {
  CONSTANTS_HEADER,
  renderRowSchemas,
  sortRelationships,
  splitConstants,
  stripPerTenantTables,
  validateDatabaseUrl,
  zodExpressionFor
} from "../../../scripts/lib/generate-db-types";
import { readLocalScriptConfig } from "../../../scripts/lib/local-script-config";
import { normalizeSwaggerSchema } from "../../../scripts/lib/swagger-schema";

describe("validateDatabaseUrl", () => {
  it.each(["localhost", "127.0.0.1", "[::1]"])(
    "accepts a local PostgreSQL host %s",
    (host) => {
      const url = `postgresql://example:synthetic@${host}:5432/example`;
      expect(validateDatabaseUrl(url)).toBe(url);
    }
  );

  it.each([
    undefined,
    "  ",
    "not-a-database-url",
    "postgresql://localhost:synthetic-secret@example.com/example",
    "postgresql://example:synthetic-secret@127.0.0.1.example.com/example",
    "postgresql://example:synthetic-secret@example.com/localhost",
    "http://example:synthetic-secret@localhost/example",
    "postgresql://example:synthetic-secret@localhost/example?host=example.com",
    "postgresql://example:synthetic-secret@localhost/example?hostaddr=192.0.2.1"
  ])("refuses %s without echoing it", (url) => {
    // The message lands in public run logs, so it must not carry the URL.
    expect(() => validateDatabaseUrl(url)).toThrow(
      expect.objectContaining({
        message: expect.not.stringMatching(/synthetic-secret|example\.com/)
      })
    );
  });
});

describe("stripPerTenantTables", () => {
  const table = (name: string) =>
    [`      ${name}: {`, "        Row: {}", "      }"].join("\n");

  it("drops per-company tables, quoted ids included, and keeps the static ones", () => {
    const source = [
      table("searchIndexRegistry"),
      table("searchIndex_dal7910g60gg2egcfj40"),
      table('"searchIndex_accttest-08e7f74786d6-company"'),
      table('"auditLog_accttest-08e7f74786d6-company"'),
      table("auditLogArchive")
    ].join("\n");
    expect(stripPerTenantTables(source)).toBe(
      [table("searchIndexRegistry"), table("auditLogArchive")].join("\n")
    );
  });

  it("drops Storage's iceberg tables, which only single-tenant Storage creates", () => {
    const source = [
      table("buckets_analytics"),
      table("iceberg_namespaces"),
      table("iceberg_tables"),
      table("objects")
    ].join("\n");
    expect(stripPerTenantTables(source)).toBe(
      [table("buckets_analytics"), table("objects")].join("\n")
    );
  });
});

describe("splitConstants", () => {
  const declarations = [
    "export type Database = {",
    '  public: { Enums: { status: "Draft" | "Done" } }',
    "}",
    ""
  ].join("\n");
  const constants = [
    "export const Constants = {",
    '  public: { Enums: { status: ["Draft", "Done"] } },',
    "} as const"
  ].join("\n");

  it("moves the Constants block into its own file and leaves only declarations", () => {
    const split = splitConstants(`${declarations}\n${constants}\n\n`);
    expect(split.types).toBe(declarations);
    expect(split.types).not.toContain("export const");
    expect(split.constants).toBe(`${CONSTANTS_HEADER}${constants}\n`);
  });

  it("refuses output with no Constants block", () => {
    expect(() => splitConstants(declarations)).toThrow(/no Constants block/);
  });
});

describe("sortRelationships", () => {
  const block = (entries: string[]) =>
    [
      "      x: {",
      "        Relationships: [",
      ...entries,
      "        ]",
      "      }"
    ].join("\n");
  const entry = (column: string, last = false) =>
    [
      "          {",
      '            foreignKeyName: "x_fkey"',
      `            columns: ["${column}"]`,
      "            isOneToOne: false",
      '            referencedRelation: "country"',
      '            referencedColumns: ["code"]',
      last ? "          }" : "          },"
    ].join("\n");

  it("orders a Relationships block the same whatever order Postgres listed it in", () => {
    const sorted = block([
      entry("customerCountryCode"),
      entry("supplierCountryCode", true)
    ]);
    const unsorted = block([
      entry("supplierCountryCode"),
      entry("customerCountryCode", true)
    ]);
    // Every entry but the last keeps its trailing comma.
    expect(sortRelationships(unsorted)).toBe(sorted);
    expect(sortRelationships(sorted)).toBe(sorted);
  });

  it("leaves an empty block alone", () => {
    const empty = "        Relationships: []\n      }";
    expect(sortRelationships(empty)).toBe(empty);
  });
});

describe("normalizeSwaggerSchema", () => {
  const pk = "This is a Primary Key.<pk/>";
  const fk =
    "This is a Foreign Key to `supplierLocation.id`.<fk table='supplierLocation' column='id'/>";
  // PostgREST puts the `partners` primary-key note on whichever alias of
  // partner.id it meets first, which differs between databases.
  const schema = (pkOn: "id" | "supplierLocationId") => ({
    definitions: {
      partners: {
        properties: {
          id: {
            description: `Original id documentation.\n\nNote:\n${pkOn === "id" ? `${pk}\n` : ""}${fk}`
          },
          supplierLocationId: {
            description: `Alias documentation.\n\nNote:\n${pkOn === "supplierLocationId" ? `${pk}\n` : ""}${fk}`
          }
        }
      },
      unrelated: { properties: { id: { description: `Leave: ${pk}` } } }
    }
  });

  it("pins the primary-key note to id whichever alias carried it", () => {
    expect(normalizeSwaggerSchema(schema("supplierLocationId"))).toEqual(
      schema("id")
    );
    expect(normalizeSwaggerSchema(schema("id"))).toEqual(schema("id"));
  });

  it("keeps the note on the alias when id has no Note block to receive it", () => {
    const input = schema("supplierLocationId");
    input.definitions.partners.properties.id.description = "No note here.";
    expect(normalizeSwaggerSchema(input)).toEqual(input);
  });

  it("does not modify its input", () => {
    const input = schema("supplierLocationId");
    normalizeSwaggerSchema(input);
    expect(input).toEqual(schema("supplierLocationId"));
  });
});

describe("readLocalScriptConfig", () => {
  it("returns only the requested values", () => {
    expect(
      readLocalScriptConfig(["A_TEST_KEY", "B_TEST_KEY"], {
        A_TEST_KEY: "a",
        B_TEST_KEY: "b",
        C_TEST_KEY: "ignored"
      })
    ).toEqual({ A_TEST_KEY: "a", B_TEST_KEY: "b" });
  });

  it("names the missing and blank keys without disclosing configured values", () => {
    let message = "";
    try {
      readLocalScriptConfig(["A_TEST_KEY", "B_TEST_KEY", "C_TEST_KEY"], {
        A_TEST_KEY: "private-value-sentinel",
        B_TEST_KEY: "   "
      });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/: B_TEST_KEY, C_TEST_KEY\./);
    expect(message).not.toContain("private-value-sentinel");
  });
});

describe("getDbTableTypeFields", () => {
  it("folds a type that wraps onto the next lines back onto its field", () => {
    __setDbTypesContentForTest(
      [
        "    Tables: {",
        "      itemLedger: {",
        "        Row: {",
        "          documentId: string | null",
        "          documentType:",
        '            | Database["public"]["Enums"]["itemLedgerDocumentType"]',
        "            | null",
        "          entryNumber: number",
        "        }",
        "      }",
        "    }",
        "    Views: {",
        "    }"
      ].join("\n")
    );
    try {
      expect(getDbTableTypeFields("itemLedger", "Row")).toEqual([
        { name: "documentId", optional: false, typeStr: "string | null" },
        {
          name: "documentType",
          optional: false,
          typeStr:
            'Database["public"]["Enums"]["itemLedgerDocumentType"] | null'
        },
        { name: "entryNumber", optional: false, typeStr: "number" }
      ]);
    } finally {
      __setDbTypesContentForTest(null);
    }
  });
});

describe("zodExpressionFor", () => {
  it.each([
    ["string", "z.string()"],
    ["string | null", "z.string().nullable()"],
    ["number", "z.number()"],
    ["boolean | null", "z.boolean().nullable()"],
    ["string[]", "z.array(z.string())"],
    ["number[] | null", "z.array(z.number()).nullable()"],
    ['Database["public"]["Enums"]["accountType"]', "enums.accountType"],
    [
      'Database["public"]["Enums"]["accountType"] | null',
      "enums.accountType.nullable()"
    ],
    [
      'Database["public"]["Enums"]["accountType"][]',
      "z.array(enums.accountType)"
    ],
    ["Json | null", "z.unknown().nullable()"],
    ["unknown", "z.unknown()"]
  ])("maps the generated column type %s", (typeStr, expected) => {
    expect(zodExpressionFor(typeStr)).toBe(expected);
  });
});

describe("renderRowSchemas", () => {
  it("writes one zod object per relation with the table its id belongs to", () => {
    __setDbTypesContentForTest(
      'export const Constants = { public: { Enums: { accountType: ["Bank", "Cash"] } } }'
    );
    try {
      const out = renderRowSchemas([
        {
          name: "account",
          kind: "table",
          table: "account",
          fields: [
            { name: "id", optional: false, typeStr: "string" },
            {
              name: "type",
              optional: false,
              typeStr: 'Database["public"]["Enums"]["accountType"]'
            }
          ]
        },
        {
          name: "accounts",
          kind: "view",
          table: "account",
          fields: [{ name: "id", optional: false, typeStr: "string | null" }]
        },
        {
          name: "summary",
          kind: "view",
          fields: [{ name: "total", optional: false, typeStr: "number | null" }]
        }
      ]);
      expect(out).toContain('accountType: z.enum(["Bank","Cash"]),');
      expect(out).toContain(
        '  "account": z.object({\n    "id": z.string(),\n    "type": enums.accountType,\n  }).meta({ table: "account" }),'
      );
      expect(out).toContain('.meta({ table: "account", view: "accounts" }),');
      expect(out).toContain('.meta({ view: "summary" }),');
    } finally {
      __setDbTypesContentForTest(null);
    }
  });
});
