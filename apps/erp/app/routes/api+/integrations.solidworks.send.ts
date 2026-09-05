import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { getReadableIdWithRevision } from "~/utils/string";
import {
  SOLIDWORKS_ROOT_INTEGRATION,
  solidWorksSendPayloadValidator
} from "./integrations.solidworks.models";

const logger = getLogger("erp", "integrations-solidworks-send");

export const config = {
  runtime: "nodejs"
};

/**
 * Inbound CAD ingest for the local SolidWorks connector.
 *
 * Auth: `carbon-key` with `parts_view`, `parts_create`, and `parts_update`.
 * Matching: `item.readableIdWithRevision` via `getReadableIdWithRevision`
 * (identical to Onshape `releaseKey`).
 * BOM persist: `sync` edge `type: "solidworks"` — same tree builder as Onshape.
 */
export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return data(
      { success: false, message: "Method not allowed" },
      { status: 405 }
    );
  }

  const { client, companyId, userId } = await requirePermissions(request, {
    view: "parts",
    create: "parts",
    update: "parts"
  });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return data(
      { success: false, message: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const parsed = solidWorksSendPayloadValidator.safeParse(body);
  if (!parsed.success) {
    return data(
      {
        success: false,
        message: "Invalid payload",
        errors: parsed.error.flatten()
      },
      { status: 400 }
    );
  }

  const payload = parsed.data;
  const { root, rows } = payload;
  const revision = root.revision;
  const readableIdWithRevision = getReadableIdWithRevision(
    root.partNumber,
    revision
  );
  const replenishmentSystem = root.replenishmentSystem ?? "Make";
  const defaultMethodType = root.defaultMethodType ?? "Make to Order";

  try {
    const existing = await client
      .from("item")
      .select("id, name, description")
      .eq("companyId", companyId)
      .eq("readableIdWithRevision", readableIdWithRevision)
      .maybeSingle();

    if (existing.error) {
      logger.error("SolidWorks send: item lookup failed", {
        error: existing.error
      });
      return data(
        { success: false, message: "Failed to look up item" },
        { status: 500 }
      );
    }

    let itemId = existing.data?.id;

    if (itemId) {
      const update = await client
        .from("item")
        .update({
          name: root.name,
          description: root.description ?? existing.data?.description ?? "",
          updatedBy: userId,
          updatedAt: new Date().toISOString()
        })
        .eq("id", itemId)
        .eq("companyId", companyId);
      if (update.error) {
        logger.error("SolidWorks send: item update failed", {
          error: update.error
        });
        return data(
          { success: false, message: "Failed to update item" },
          { status: 500 }
        );
      }
    } else {
      const created = await client
        .from("item")
        .insert({
          readableId: root.partNumber,
          revision,
          name: root.name,
          description: root.description,
          type: "Part",
          unitOfMeasureCode: "EA",
          itemTrackingType: "Inventory",
          replenishmentSystem,
          defaultMethodType,
          companyId,
          createdBy: userId
        })
        .select("id")
        .single();

      if (created.error || !created.data?.id) {
        logger.error("SolidWorks send: item create failed", {
          error: created.error
        });
        return data(
          {
            success: false,
            message: created.error?.message
              ? `Failed to create item: ${created.error.message}`
              : "Failed to create item"
          },
          { status: 500 }
        );
      }
      itemId = created.data.id;

      const partInsert = await client.from("part").upsert({
        id: root.partNumber,
        companyId,
        createdBy: userId
      });
      if (partInsert.error) {
        logger.error("SolidWorks send: part upsert failed", {
          error: partInsert.error
        });
        return data(
          { success: false, message: "Failed to create part" },
          { status: 500 }
        );
      }
    }

    const methods = await client
      .from("makeMethod")
      .select("id, status, version")
      .eq("itemId", itemId)
      .eq("companyId", companyId)
      .order("version", { ascending: false });

    if (methods.error) {
      logger.error("SolidWorks send: makeMethod lookup failed", {
        error: methods.error
      });
      return data(
        { success: false, message: "Failed to look up make method" },
        { status: 500 }
      );
    }

    const draft = methods.data?.find((method) => method.status === "Draft");
    const active = methods.data?.find((method) => method.status === "Active");
    let makeMethodId = draft?.id ?? active?.id ?? methods.data?.[0]?.id;

    if (!makeMethodId) {
      const inserted = await client
        .from("makeMethod")
        .insert({
          itemId,
          companyId,
          createdBy: userId,
          status: "Draft"
        })
        .select("id")
        .single();
      if (inserted.error || !inserted.data?.id) {
        logger.error("SolidWorks send: makeMethod create failed", {
          error: inserted.error
        });
        return data(
          {
            success: false,
            message: inserted.error?.message
              ? `Failed to create make method: ${inserted.error.message}`
              : "Failed to create make method"
          },
          { status: 500 }
        );
      }
      makeMethodId = inserted.data.id;
    }

    const serviceRole = getCarbonServiceRole();

    if (rows.length > 0) {
      const sync = await serviceRole.functions.invoke("sync", {
        body: {
          type: "solidworks",
          makeMethodId,
          data: rows,
          companyId,
          userId
        }
      });

      if (sync.error) {
        const detail =
          typeof sync.error === "object" &&
          sync.error &&
          "message" in sync.error &&
          typeof sync.error.message === "string"
            ? sync.error.message
            : String(sync.error);
        logger.info("Failed to sync SolidWorks BOM", {
          error: sync.error,
          data: sync.data
        });
        return data(
          {
            success: false,
            message: `Failed to sync SolidWorks BOM: ${detail}`
          },
          { status: 400 }
        );
      }
    }

    await serviceRole
      .from("externalIntegrationMapping")
      .delete()
      .eq("entityType", "item")
      .eq("entityId", itemId)
      .eq("integration", SOLIDWORKS_ROOT_INTEGRATION)
      .eq("companyId", companyId);

    await serviceRole.from("externalIntegrationMapping").insert({
      entityType: "item",
      entityId: itemId,
      integration: SOLIDWORKS_ROOT_INTEGRATION,
      metadata: {
        sourcePath: root.sourcePath,
        configuration: root.configuration,
        connectorVersion: payload.connectorVersion,
        idempotencyKey: payload.idempotencyKey
      },
      lastSyncedAt: new Date().toISOString(),
      companyId
    });

    const componentItems =
      rows.length === 0
        ? []
        : ((
            await client
              .from("item")
              .select("id, readableId, revision, readableIdWithRevision")
              .eq("companyId", companyId)
              .in(
                "readableIdWithRevision",
                Array.from(
                  new Set(
                    rows.map((row) =>
                      getReadableIdWithRevision(
                        row.readableId || row.name,
                        row.revision
                      )
                    )
                  )
                )
              )
          ).data ?? []);

    return {
      success: true,
      message: "Sent to Carbon",
      itemId,
      makeMethodId,
      readableIdWithRevision,
      items: [
        {
          itemId,
          readableId: root.partNumber,
          revision,
          readableIdWithRevision
        },
        ...componentItems.map((item) => ({
          itemId: item.id,
          readableId: item.readableId,
          revision: item.revision,
          readableIdWithRevision: item.readableIdWithRevision
        }))
      ],
      diagnostics: payload.diagnostics ?? []
    };
  } catch (error) {
    logger.error("SolidWorks send failed", { error });
    return data(
      { success: false, message: "SolidWorks send failed" },
      { status: 500 }
    );
  }
}
