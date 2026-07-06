import type { Database } from "@carbon/database";
import { redis } from "@carbon/kv";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PrinterContext } from "./assignments";
import { resolveContextAssignment } from "./assignments";
import type { PrintingSettings } from "./types";

const CACHE_TTL_SECONDS = 3600;
const KEY_PREFIX = "printing";

export type CachedPrinterConfig = {
  printerRouteId: string | null;
  printerUrl: string;
  format: "zpl" | "pdf";
  mediaSizeId: string | null;
  templateId: string | null;
  autoPrint: boolean;
};

function buildCacheKey(
  companyId: string,
  locationId: string,
  context: PrinterContext,
  contextId?: string
): string {
  const suffix =
    context === "workCenter" && contextId ? `wc:${contextId}` : context;
  return `${KEY_PREFIX}:${companyId}:${locationId}:${suffix}`;
}

export async function getCachedPrinterConfig(
  client: SupabaseClient<Database>,
  companyId: string,
  locationId: string,
  context: PrinterContext,
  contextId?: string
): Promise<CachedPrinterConfig | null> {
  const key = buildCacheKey(companyId, locationId, context, contextId);

  try {
    const cached = await redis.get(key);
    if (cached && typeof cached === "string") {
      return JSON.parse(cached) as CachedPrinterConfig;
    }
  } catch {
    // Redis unavailable — fall through to DB
  }

  const config = await resolvePrinterConfig(
    client,
    companyId,
    locationId,
    context,
    contextId
  );

  if (config) {
    try {
      await redis.set(key, JSON.stringify(config), "EX", CACHE_TTL_SECONDS);
    } catch {
      // Cache write failed — non-fatal
    }
  }

  return config;
}

async function resolvePrinterConfig(
  client: SupabaseClient<Database>,
  companyId: string,
  locationId: string,
  context: PrinterContext,
  contextId?: string
): Promise<CachedPrinterConfig | null> {
  const { data: settings } = await client
    .from("companySettings")
    .select("printing")
    .eq("id", companyId)
    .single();

  const printing = settings?.printing as PrintingSettings | null;
  const assignment = printing?.assignments?.[locationId];
  if (!assignment) return null;

  const { printerRouteId, autoPrint } = resolveContextAssignment(
    assignment,
    context,
    contextId
  );

  if (!printerRouteId) {
    return {
      printerRouteId: null,
      printerUrl: "",
      format: "zpl",
      mediaSizeId: null,
      templateId: null,
      autoPrint
    };
  }

  const { data: route } = await client
    .from("printerRoute")
    .select("id, format, mediaSizeId, printerUrl, apiKey, templateId")
    .eq("id", printerRouteId)
    .eq("companyId", companyId)
    .single();

  if (!route) {
    return {
      printerRouteId,
      printerUrl: "",
      format: "zpl",
      mediaSizeId: null,
      templateId: null,
      autoPrint
    };
  }

  return {
    printerRouteId: route.id,
    printerUrl: route.printerUrl,
    format: route.format as "zpl" | "pdf",
    mediaSizeId: route.mediaSizeId,
    templateId: route.templateId,
    autoPrint
  };
}

export async function invalidatePrinterCache(companyId: string): Promise<void> {
  try {
    const keys = await redis.keys(`${KEY_PREFIX}:${companyId}:*`);
    if (keys.length > 0) {
      const pipeline = redis.pipeline();
      for (const key of keys) {
        pipeline.del(key);
      }
      await pipeline.exec();
    }
  } catch {
    // Cache invalidation failed — entries will expire via TTL
  }
}
