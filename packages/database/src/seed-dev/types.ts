import type { PoolClient } from "pg";
import { maybeOne, one } from "./sql.ts";

// Ids collected as tiers run, so a later tier can reference an earlier one's
// rows by a stable human key instead of re-querying.
export type SeedRefs = {
  locations: Record<string, string>;
  shelves: Record<string, string>;
  warehouses: Record<string, string>;
  departments: Record<string, string>;
  shifts: Record<string, string>;
  abilities: Record<string, string>;
  processes: Record<string, string>;
  workCenters: Record<string, string>;
  suppliers: Record<string, string>;
  customers: Record<string, string>;
  contacts: Record<string, string>;
  shippingMethods: Record<string, string>;
  items: Record<string, ItemRef>;
  makeMethods: Record<string, string>;
  documents: Record<string, string>;
  misc: Record<string, string>;
};

export type ItemRef = {
  id: string;
  readableId: string;
  revision: string;
  name: string;
  type: ItemType;
  makeMethodId: string | null;
  // Drives the BOM line's methodType — a Make component is a subassembly.
  isMake: boolean;
  unitCost: number;
  unitOfMeasureCode: string;
};

export type ItemType =
  | "Part"
  | "Material"
  | "Tool"
  | "Consumable"
  | "Service"
  | "Fixture";

export type Ctx = {
  client: PoolClient;
  companyId: string;
  companyGroupId: string;
  userId: string;
  locationId: string;
  refs: SeedRefs;
  log: (message: string) => void;
};

export type Tier = {
  n: number;
  name: string;
  run: (ctx: Ctx) => Promise<void>;
};

export function emptyRefs(): SeedRefs {
  return {
    locations: {},
    shelves: {},
    warehouses: {},
    departments: {},
    shifts: {},
    abilities: {},
    processes: {},
    workCenters: {},
    suppliers: {},
    customers: {},
    contacts: {},
    shippingMethods: {},
    items: {},
    makeMethods: {},
    documents: {},
    misc: {}
  };
}

export type Resolved = { companyId: string; userId: string };

// Returns null when the email is unknown — the caller bootstraps in that case.
export async function resolveCompany(
  client: PoolClient,
  email: string
): Promise<Resolved | null> {
  const row = await maybeOne<{ companyId: string; userId: string }>(
    client,
    `SELECT utc."companyId", utc."userId"
     FROM "userToCompany" utc
     JOIN "user" u ON u.id = utc."userId"
     WHERE u.email = $1 AND utc.role = 'employee'
     ORDER BY utc."companyId"
     LIMIT 1`,
    [email]
  );
  return row ? { companyId: row.companyId, userId: row.userId } : null;
}

// Everything the tiers assume about the company is validated here, before BEGIN.
export async function buildCtx(
  client: PoolClient,
  companyId: string,
  userId: string
): Promise<Ctx> {
  const company = await one<{ id: string; companyGroupId: string }>(
    client,
    `SELECT id, "companyGroupId" FROM company WHERE id = $1`,
    [companyId]
  );

  const location = await one<{ id: string }>(
    client,
    `SELECT id FROM location WHERE "companyId" = $1 ORDER BY "createdAt", id LIMIT 1`,
    [companyId]
  );

  await one(
    client,
    `SELECT code FROM "unitOfMeasure" WHERE "companyId" = $1 AND code = 'EA'`,
    [companyId]
  );

  return {
    client,
    companyId,
    companyGroupId: company.companyGroupId,
    userId,
    locationId: location.id,
    refs: emptyRefs(),
    log: (message: string) => console.log(`  ${message}`)
  };
}
