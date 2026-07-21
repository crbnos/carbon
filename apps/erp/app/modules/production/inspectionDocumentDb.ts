import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";

type ProcedureStepType = Database["public"]["Enums"]["procedureStepType"];

/** Row shapes for inspection tables until `pnpm db:types` includes them. */
export type InspectionFeatureRow = {
  id: string;
  inspectionDocumentId: string;
  companyId: string;
  pageNumber: number;
  label: string;
  description: string | null;
  nominalValue: string | null;
  tolerancePlus: string | null;
  toleranceMinus: string | null;
  unit: string | null;
  type: ProcedureStepType;
  createdBy: string;
  createdAt: string;
  updatedBy: string | null;
  updatedAt: string | null;
};

export type BalloonRow = {
  id: string;
  inspectionDocumentId: string;
  companyId: string;
  inspectionFeatureId: string;
  pageNumber: number;
  regionX: number;
  regionY: number;
  regionWidth: number;
  regionHeight: number;
  xCoordinate: number;
  yCoordinate: number;
  createdBy: string;
  createdAt: string;
  updatedBy: string | null;
  updatedAt: string | null;
};

type InspectionDbClient = {
  from: (table: "inspectionFeature" | "balloon" | "inspectionDocument") => {
    select: (columns?: string) => {
      eq: (
        column: string,
        value: unknown
      ) => {
        order: (
          column: string,
          opts: { ascending: boolean }
        ) => Promise<{ data: unknown[] | null; error: unknown }>;
        single: () => Promise<{ data: unknown | null; error: unknown }>;
        is: (
          column: string,
          value: null
        ) => {
          order: (
            column: string,
            opts?: { ascending?: boolean }
          ) => {
            order: (
              column: string,
              opts?: { ascending?: boolean }
            ) => Promise<{ data: unknown[] | null; error: unknown }>;
          };
        };
      };
    };
    delete: () => {
      eq: (column: string, value: unknown) => Promise<{ error: unknown }>;
    };
  };
};

export function inspectionDb(client: SupabaseClient<Database>) {
  return client as unknown as InspectionDbClient;
}

export async function listInspectionFeatures(
  client: SupabaseClient<Database>,
  inspectionDocumentId: string
) {
  const result = await inspectionDb(client)
    .from("inspectionFeature")
    .select("*")
    .eq("inspectionDocumentId", inspectionDocumentId)
    .order("createdAt", { ascending: true });

  return {
    data: (result.data ?? []) as InspectionFeatureRow[],
    error: result.error
  };
}

export async function listBalloons(
  client: SupabaseClient<Database>,
  inspectionDocumentId: string
) {
  const result = await inspectionDb(client)
    .from("balloon")
    .select("*")
    .eq("inspectionDocumentId", inspectionDocumentId)
    .order("createdAt", { ascending: true });

  return {
    data: (result.data ?? []) as BalloonRow[],
    error: result.error
  };
}

/** Maps persisted balloon ids to inspectionFeature ids for legacy save payloads. */
export async function mapBalloonIdsToFeatureIdsForDocument(
  client: SupabaseClient<Database>,
  inspectionDocumentId: string,
  ids: string[]
) {
  const unique = [...new Set(ids.filter((id) => id.length > 0))];
  const mapped = new Map<string, string>();
  for (const id of unique) {
    mapped.set(id, id);
  }

  const balloonsResult = await listBalloons(client, inspectionDocumentId);
  for (const balloon of balloonsResult.data ?? []) {
    if (mapped.has(balloon.id)) {
      mapped.set(balloon.id, balloon.inspectionFeatureId);
    }
  }

  const featuresResult = await listInspectionFeatures(
    client,
    inspectionDocumentId
  );
  for (const row of featuresResult.data ?? []) {
    if (mapped.has(row.id)) {
      mapped.set(row.id, row.id);
    }
  }

  return mapped;
}
