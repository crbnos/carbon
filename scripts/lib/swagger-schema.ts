import { readFileSync } from "node:fs";
import { join } from "node:path";

export const PARTNER_ALIAS_PROOF_SQL = readFileSync(
  join(__dirname, "swagger-partner-alias.sql"),
  "utf8"
);

// The complete, reviewed pg_get_viewdef output proves column origins without
// interpreting arbitrary SQL or trusting PostgREST's inferred descriptions.
// A changed view requires an explicit review of this compatibility correction.
const PARTNERS_VIEW = `SELECT p.id, p."hoursPerWeek", p."abilityId", p.active,
 p."companyId", p."createdBy", p."createdAt", p."updatedBy", p."updatedAt", p."customFields",
 p.id AS "supplierLocationId", a2.name AS "abilityName", s.id AS "supplierId",
 s.name AS "supplierName", a.city, a."stateProvince" AS state
 FROM ((((public.partner p
 JOIN public."supplierLocation" sl ON ((sl.id = p.id)))
 JOIN public.supplier s ON ((s.id = sl."supplierId")))
 JOIN public.address a ON ((a.id = sl."addressId")))
 JOIN public.ability a2 ON ((a2.id = p."abilityId"))) WHERE (p.active = true);`;

const PRIMARY_KEY_NOTE = "This is a Primary Key.<pk/>";
const foreignKeyNote = (table: string) =>
  `This is a Foreign Key to \`${table}.id\`.<fk table='${table}' column='id'/>`;

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Unexpected Swagger metadata object");
  return value as Record<string, unknown>;
}

function sqlTokens(source: string): string {
  // Preserve quoted identifiers/string contents; only token whitespace varies.
  return JSON.stringify(
    source.match(
      /"(?:[^"]|"")*"|'(?:[^']|'')*'|[A-Za-z_][A-Za-z_0-9]*|[0-9]+|[^\s]/g
    )
  );
}

function verifyProof(value: unknown): void {
  if (!Array.isArray(value) || value.length !== 1)
    throw new Error("Partner alias schema proof is unavailable");
  const row = object(value[0]);
  if (
    row.relation_kind !== "v" ||
    typeof row.view_definition !== "string" ||
    sqlTokens(row.view_definition) !== sqlTokens(PARTNERS_VIEW) ||
    JSON.stringify(row.primary_key) !== JSON.stringify(["id", "abilityId"])
  )
    throw new Error(
      "Partner alias schema proof changed; review the compatibility correction"
    );
}

function columnNote(value: unknown, table: string) {
  const column = object(value);
  const description = column.description;
  if (
    column.type !== "string" ||
    column.format !== "text" ||
    typeof description !== "string"
  )
    throw new Error("Unexpected partner alias column metadata");
  const fk = foreignKeyNote(table);
  const withPrimary = `Note:\n${PRIMARY_KEY_NOTE}\n${fk}`;
  const withoutPrimary = `Note:\n${fk}`;
  const primary = description.endsWith(withPrimary);
  const suffix = primary ? withPrimary : withoutPrimary;
  if (!description.endsWith(suffix))
    throw new Error("Unexpected partner alias key metadata");
  const prefix = description.slice(0, -suffix.length);
  if (
    (prefix && !prefix.endsWith("\n\n")) ||
    prefix.includes("<pk/>") ||
    prefix.includes("<fk ")
  )
    throw new Error("Unexpected partner alias description metadata");
  return { column, prefix, primary, fk };
}

export function normalizeSwaggerSchema(
  schema: unknown,
  proof: unknown
): unknown {
  verifyProof(proof);
  const result = structuredClone(object(schema));
  if (result.swagger !== "2.0")
    throw new Error("Unexpected Swagger version metadata");
  const properties = object(
    object(object(result.definitions).partners).properties
  );
  const id = columnNote(properties.id, "supplierLocation");
  const alias = columnNote(properties.supplierLocationId, "supplierLocation");
  const ability = columnNote(properties.abilityId, "ability");
  if (id.primary === alias.primary || !ability.primary)
    throw new Error("Unexpected partner composite primary-key metadata");
  // PostgREST 13 chooses an unordered first alias for a source PK column.
  // Select the first projected alias while preserving every FK and prose byte.
  id.column.description = `${id.prefix}Note:\n${PRIMARY_KEY_NOTE}\n${id.fk}`;
  alias.column.description = `${alias.prefix}Note:\n${alias.fk}`;
  return result;
}
