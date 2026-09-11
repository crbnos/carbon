import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  normalizeSwaggerSchema,
  PARTNER_ALIAS_PROOF_SQL
} from "./swagger-schema";

const view = `SELECT p.id, p."hoursPerWeek", p."abilityId", p.active,
  p."companyId", p."createdBy", p."createdAt", p."updatedBy", p."updatedAt", p."customFields",
  p.id AS "supplierLocationId", a2.name AS "abilityName", s.id AS "supplierId",
  s.name AS "supplierName", a.city, a."stateProvince" AS state
 FROM ((((public.partner p
  JOIN public."supplierLocation" sl ON ((sl.id = p.id)))
  JOIN public.supplier s ON ((s.id = sl."supplierId")))
  JOIN public.address a ON ((a.id = sl."addressId")))
  JOIN public.ability a2 ON ((a2.id = p."abilityId"))) WHERE (p.active = true);`;
const pk = "This is a Primary Key.<pk/>";
const fk =
  "This is a Foreign Key to `supplierLocation.id`.<fk table='supplierLocation' column='id'/>";
const proof = () => [
  {
    view_definition: view,
    primary_key: ["id", "abilityId"],
    relation_kind: "v"
  }
];
const fixture = (chosen: "id" | "supplierLocationId") => ({
  swagger: "2.0",
  definitions: {
    partners: {
      properties: {
        id: {
          type: "string",
          format: "text",
          description: `Original id documentation.\n\nNote:\n${chosen === "id" ? `${pk}\n` : ""}${fk}`
        },
        supplierLocationId: {
          type: "string",
          format: "text",
          description: `Alias documentation.\n\nNote:\n${chosen === "supplierLocationId" ? `${pk}\n` : ""}${fk}`
        },
        abilityId: {
          type: "string",
          format: "text",
          description: `Note:\n${pk}\nThis is a Foreign Key to \`ability.id\`.<fk table='ability' column='id'/>`
        }
      }
    },
    unrelated: { properties: { id: { description: `Leave untouched: ${pk}` } } }
  },
  paths: { "/partners": { get: { description: "Public API contract" } } }
});

test("both observed alias choices generate identical metadata with the composite key preserved", () => {
  assert.deepEqual(
    normalizeSwaggerSchema(fixture("supplierLocationId"), proof()),
    fixture("id")
  );
  assert.deepEqual(
    normalizeSwaggerSchema(fixture("id"), proof()),
    fixture("id")
  );
});

test("generation twice is identical and leaves the input object intact", () => {
  const input = fixture("supplierLocationId");
  const saved = structuredClone(input);
  const first = normalizeSwaggerSchema(input, proof());
  assert.deepEqual(first, normalizeSwaggerSchema(first, proof()));
  assert.deepEqual(input, saved);
});

for (const [name, mutate] of [
  [
    "key column removed",
    (rows: ReturnType<typeof proof>) => {
      rows[0]!.primary_key = ["id"];
    }
  ],
  [
    "key column added",
    (rows: ReturnType<typeof proof>) => {
      rows[0]!.primary_key.push("companyId");
    }
  ],
  [
    "key order changed",
    (rows: ReturnType<typeof proof>) => {
      rows[0]!.primary_key.reverse();
    }
  ],
  [
    "alias comes from another table",
    (rows: ReturnType<typeof proof>) => {
      rows[0]!.view_definition = view.replace(
        'p.id AS "supplierLocationId"',
        'sl.id AS "supplierLocationId"'
      );
    }
  ],
  [
    "alias is an expression",
    (rows: ReturnType<typeof proof>) => {
      rows[0]!.view_definition = view.replace(
        'p.id AS "supplierLocationId"',
        "(p.id || '') AS \"supplierLocationId\""
      );
    }
  ],
  [
    "source relation changed",
    (rows: ReturnType<typeof proof>) => {
      rows[0]!.view_definition = view.replace(
        "public.partner p",
        "public.other p"
      );
    }
  ],
  [
    "column spelling changed",
    (rows: ReturnType<typeof proof>) => {
      rows[0]!.view_definition = view.replace(
        '"hoursPerWeek"',
        '"hours Per Week"'
      );
    }
  ],
  [
    "view became a table",
    (rows: ReturnType<typeof proof>) => {
      rows[0]!.relation_kind = "r";
    }
  ],
  [
    "proof missing",
    (rows: ReturnType<typeof proof>) => {
      rows.length = 0;
    }
  ]
] as const) {
  test(`rejects actual schema drift: ${name}`, () => {
    const rows = proof();
    mutate(rows);
    assert.throws(
      () => normalizeSwaggerSchema(fixture("id"), rows),
      /proof|schema/
    );
  });
}

async function runCli(
  options: {
    invalidProof?: boolean;
    proofStatus?: number;
    malformedProofJson?: boolean;
    malformedSchema?: boolean;
    repeat?: boolean;
  } = {}
) {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const directory = mkdtempSync(join(tmpdir(), "carbon-swagger-generation-"));
  const output = join(
    directory,
    "packages/database/src/swagger-docs-schema.ts"
  );
  const previous = "export default { previous: true };\n";
  const requests: {
    method: string | undefined;
    url: string | undefined;
    body: string;
  }[] = [];
  let generations = 0;
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    requests.push({ method: request.method, url: request.url, body });
    response.setHeader("Content-Type", "application/json");
    if (
      request.method === "GET" &&
      request.url === "/api/platform/projects/default/api/rest"
    ) {
      response.end(
        JSON.stringify(
          options.malformedSchema
            ? []
            : fixture(generations++ % 2 === 0 ? "supplierLocationId" : "id")
        )
      );
    } else if (
      request.method === "POST" &&
      request.url === "/api/platform/pg-meta/default/query" &&
      body === JSON.stringify({ query: PARTNER_ALIAS_PROOF_SQL })
    ) {
      response.statusCode = options.proofStatus ?? 200;
      const rows = proof();
      if (options.invalidProof) rows[0]!.primary_key = ["id"];
      response.end(
        options.malformedProofJson
          ? "synthetic-private-diagnostic"
          : JSON.stringify(
              response.statusCode === 200
                ? rows
                : { error: "synthetic-private-diagnostic" }
            )
      );
    } else {
      response.statusCode = 400;
      response.end("{}");
    }
  });
  try {
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve)
    );
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, previous);
    mkdirSync(join(directory, "scripts/lib"), { recursive: true });
    for (const path of [
      "scripts/generate-swagger-docs.ts",
      "scripts/lib/swagger-schema.ts",
      "scripts/lib/swagger-partner-alias.sql"
    ])
      copyFileSync(join(root, path), join(directory, path));
    const results = [];
    for (let iteration = 0; iteration < (options.repeat ? 2 : 1); iteration++) {
      const child = spawn(
        process.execPath,
        [
          "--import",
          join(root, "node_modules/tsx/dist/loader.mjs"),
          join(directory, "scripts/generate-swagger-docs.ts")
        ],
        {
          cwd: directory,
          env: {
            PATH: process.env.PATH,
            PORT_STUDIO: String(address.port),
            NODE_PATH: undefined
          },
          stdio: ["ignore", "pipe", "pipe"]
        }
      );
      let stderr = "";
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      const code = await new Promise<number | null>((resolve, reject) => {
        child.once("error", reject);
        child.once("close", resolve);
      });
      results.push({ code, stderr, output: readFileSync(output, "utf8") });
    }
    return {
      results,
      requests,
      previous,
      remaining: readdirSync(dirname(output))
    };
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(directory, { recursive: true, force: true });
  }
}

test("real CLI requests catalog proof and produces identical files for both observed variants", async () => {
  const result = await runCli({ repeat: true });
  for (const run of result.results) assert.equal(run.code, 0, run.stderr);
  assert.equal(
    result.requests.filter((request) => request.method === "POST").length,
    2
  );
  assert.equal(result.results[0]!.output, result.results[1]!.output);
});

for (const options of [
  { invalidProof: true },
  { proofStatus: 403 },
  { malformedSchema: true },
  { malformedProofJson: true }
]) {
  test(`real CLI preserves last-good output when verification fails: ${JSON.stringify(options)}`, async () => {
    const result = await runCli(options);
    assert.notEqual(result.results[0]!.code, 0);
    assert.equal(result.results[0]!.output, result.previous);
    assert.deepEqual(result.remaining, ["swagger-docs-schema.ts"]);
    assert.doesNotMatch(result.results[0]!.stderr, /synthetic/);
  });
}

for (const [name, mutate] of [
  [
    "both aliases marked primary",
    (schema: ReturnType<typeof fixture>) => {
      schema.definitions.partners.properties.supplierLocationId.description = `Note:\n${pk}\n${fk}`;
    }
  ],
  [
    "neither alias marked primary",
    (schema: ReturnType<typeof fixture>) => {
      schema.definitions.partners.properties.id.description = `Note:\n${fk}`;
    }
  ],
  [
    "foreign key changed",
    (schema: ReturnType<typeof fixture>) => {
      schema.definitions.partners.properties.id.description =
        schema.definitions.partners.properties.id.description.replaceAll(
          "supplierLocation",
          "otherTable"
        );
    }
  ],
  [
    "unknown primary key notation",
    (schema: ReturnType<typeof fixture>) => {
      schema.definitions.partners.properties.id.description =
        schema.definitions.partners.properties.id.description.replace(
          pk,
          "Primary key: id"
        );
    }
  ],
  [
    "composite key member loses its marker",
    (schema: ReturnType<typeof fixture>) => {
      schema.definitions.partners.properties.abilityId.description =
        "Changed metadata";
    }
  ],
  [
    "column type changed",
    (schema: ReturnType<typeof fixture>) => {
      schema.definitions.partners.properties.id.type = "number";
    }
  ]
] as const) {
  test(`rejects unrecognized metadata: ${name}`, () => {
    const schema = fixture("id");
    mutate(schema);
    assert.throws(() => normalizeSwaggerSchema(schema, proof()), /metadata/);
  });
}
