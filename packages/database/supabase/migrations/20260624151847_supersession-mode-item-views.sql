-- Add supersession lifecycle (supersessionMode) to the materials, tools, and
-- consumables list views so the phase-out/obsolete badge can render in their
-- tables (the parts view already exposes it). Forked verbatim from the live
-- view definitions with a LEFT JOIN to itemSupersession + the column appended.

CREATE OR REPLACE VIEW "materials" WITH (security_invoker = true) AS
 WITH latest_items AS (
         SELECT DISTINCT ON (i_1."readableId", i_1."companyId") i_1.id,
            i_1."readableId",
            i_1.name,
            i_1.description,
            i_1.type,
            i_1."replenishmentSystem",
            i_1."defaultMethodType",
            i_1."itemTrackingType",
            i_1."unitOfMeasureCode",
            i_1.active,
            i_1."companyId",
            i_1."createdBy",
            i_1."createdAt",
            i_1."updatedBy",
            i_1."updatedAt",
            i_1.assignee,
            i_1."modelUploadId",
            i_1."thumbnailPath",
            i_1.notes,
            i_1."trackingMethod",
            i_1.embedding,
            i_1.revision,
            i_1."readableIdWithRevision",
            i_1."requiresInspection",
            mu_1."modelPath",
            mu_1."thumbnailPath" AS "modelThumbnailPath",
            mu_1.name AS "modelName",
            mu_1.size AS "modelSize"
           FROM item i_1
             LEFT JOIN "modelUpload" mu_1 ON mu_1.id = i_1."modelUploadId"
          WHERE i_1.type = 'Material'::"itemType"
          ORDER BY i_1."readableId", i_1."companyId", (
                CASE
                    WHEN i_1.revision = '0'::text OR i_1.revision = ''::text OR i_1.revision IS NULL THEN 0
                    ELSE 1
                END) DESC, i_1."createdAt" DESC NULLS LAST
        ), item_revisions AS (
         SELECT i_1."readableId",
            i_1."companyId",
            json_agg(json_build_object('id', i_1.id, 'revision', i_1.revision, 'methodType', i_1."defaultMethodType", 'type', i_1.type) ORDER BY (
                CASE
                    WHEN i_1.revision = '0'::text OR i_1.revision = ''::text OR i_1.revision IS NULL THEN 0
                    ELSE 1
                END), i_1."createdAt") AS revisions
           FROM item i_1
          WHERE i_1.type = 'Material'::"itemType"
          GROUP BY i_1."readableId", i_1."companyId"
        )
 SELECT i.active,
    i.assignee,
    i."defaultMethodType",
    i.description,
    i."itemTrackingType",
    i.name,
    i."replenishmentSystem",
    i."unitOfMeasureCode",
    i.notes,
    i.revision,
    i."readableId",
    i."readableIdWithRevision",
    i.id,
    i."companyId",
        CASE
            WHEN i."thumbnailPath" IS NULL AND i."modelThumbnailPath" IS NOT NULL THEN i."modelThumbnailPath"
            ELSE i."thumbnailPath"
        END AS "thumbnailPath",
    i."modelUploadId",
    i."modelPath",
    i."modelName",
    i."modelSize",
    ps."supplierIds",
    uom.name AS "unitOfMeasure",
    ir.revisions,
    mf.name AS "materialForm",
    ms.name AS "materialSubstance",
    md.name AS dimensions,
    mfin.name AS finish,
    mg.name AS grade,
    mt.name AS "materialType",
    m."materialSubstanceId",
    m."materialFormId",
    m."customFields",
    m.tags,
    ic."itemPostingGroupId",
    ( SELECT COALESCE(jsonb_object_agg(eim.integration,
                CASE
                    WHEN eim.metadata IS NOT NULL THEN eim.metadata
                    ELSE to_jsonb(eim."externalId")
                END) FILTER (WHERE eim."externalId" IS NOT NULL OR eim.metadata IS NOT NULL), '{}'::jsonb) AS "coalesce"
           FROM "externalIntegrationMapping" eim
          WHERE eim."entityType" = 'item'::text AND eim."entityId" = i.id) AS "externalId",
    i."createdBy",
    i."createdAt",
    i."updatedBy",
    i."updatedAt",
    ss."supersessionMode"
   FROM material m
     JOIN latest_items i ON i."readableId" = m.id AND i."companyId" = m."companyId"
     LEFT JOIN item_revisions ir ON ir."readableId" = m.id AND ir."companyId" = i."companyId"
     LEFT JOIN ( SELECT ps_1."itemId",
            ps_1."companyId",
            string_agg(ps_1."supplierPartId", ','::text) AS "supplierIds"
           FROM "supplierPart" ps_1
          GROUP BY ps_1."itemId", ps_1."companyId") ps ON ps."itemId" = i.id AND ps."companyId" = i."companyId"
     LEFT JOIN "modelUpload" mu ON mu.id = i."modelUploadId"
     LEFT JOIN "unitOfMeasure" uom ON uom.code = i."unitOfMeasureCode" AND uom."companyId" = i."companyId"
     LEFT JOIN "materialForm" mf ON mf.id = m."materialFormId"
     LEFT JOIN "materialSubstance" ms ON ms.id = m."materialSubstanceId"
     LEFT JOIN "materialDimension" md ON m."dimensionId" = md.id
     LEFT JOIN "materialFinish" mfin ON m."finishId" = mfin.id
     LEFT JOIN "materialGrade" mg ON m."gradeId" = mg.id
     LEFT JOIN "materialType" mt ON m."materialTypeId" = mt.id
     LEFT JOIN "itemCost" ic ON ic."itemId" = i.id
     LEFT JOIN "itemSupersession" ss ON ss."itemId" = i.id AND ss."companyId" = i."companyId";

CREATE OR REPLACE VIEW "tools" WITH (security_invoker = true) AS
 WITH latest_items AS (
         SELECT DISTINCT ON (i."readableId", i."companyId") i.id,
            i."readableId",
            i.name,
            i.description,
            i.type,
            i."replenishmentSystem",
            i."defaultMethodType",
            i."itemTrackingType",
            i."unitOfMeasureCode",
            i.active,
            i."companyId",
            i."createdBy",
            i."createdAt",
            i."updatedBy",
            i."updatedAt",
            i.assignee,
            i."modelUploadId",
            i."thumbnailPath",
            i.notes,
            i."trackingMethod",
            i.embedding,
            i.revision,
            i."readableIdWithRevision",
            i."requiresInspection",
            i."sourcingType",
            mu.id AS "modelUploadId",
            mu."modelPath",
            mu."thumbnailPath" AS "modelThumbnailPath",
            mu.name AS "modelName",
            mu.size AS "modelSize"
           FROM item i
             LEFT JOIN "modelUpload" mu ON mu.id = i."modelUploadId"
          WHERE i.type = 'Tool'::"itemType"
          ORDER BY i."readableId", i."companyId", (
                CASE
                    WHEN i.revision = '0'::text OR i.revision = ''::text OR i.revision IS NULL THEN 0
                    ELSE 1
                END) DESC, i."createdAt" DESC NULLS LAST
        ), item_revisions AS (
         SELECT i."readableId",
            i."companyId",
            json_agg(json_build_object('id', i.id, 'revision', i.revision, 'methodType', i."defaultMethodType", 'type', i.type) ORDER BY (
                CASE
                    WHEN i.revision = '0'::text OR i.revision = ''::text OR i.revision IS NULL THEN 0
                    ELSE 1
                END), i."createdAt") AS revisions
           FROM item i
          WHERE i.type = 'Tool'::"itemType"
          GROUP BY i."readableId", i."companyId"
        )
 SELECT li.active,
    li.assignee,
    li."defaultMethodType",
    li."sourcingType",
    li.description,
    li."itemTrackingType",
    li.name,
    li."replenishmentSystem",
    li."unitOfMeasureCode",
    li.notes,
    li.revision,
    li."readableId",
    li."readableIdWithRevision",
    li.id,
    li."companyId",
        CASE
            WHEN li."thumbnailPath" IS NULL AND li."modelThumbnailPath" IS NOT NULL THEN li."modelThumbnailPath"
            ELSE li."thumbnailPath"
        END AS "thumbnailPath",
    li."modelPath",
    li."modelName",
    li."modelSize",
    ps."supplierIds",
    uom.name AS "unitOfMeasure",
    ir.revisions,
    t."customFields",
    t.tags,
    ic."itemPostingGroupId",
    ( SELECT COALESCE(jsonb_object_agg(eim.integration,
                CASE
                    WHEN eim.metadata IS NOT NULL THEN eim.metadata
                    ELSE to_jsonb(eim."externalId")
                END) FILTER (WHERE eim."externalId" IS NOT NULL OR eim.metadata IS NOT NULL), '{}'::jsonb) AS "coalesce"
           FROM "externalIntegrationMapping" eim
          WHERE eim."entityType" = 'item'::text AND eim."entityId" = li.id) AS "externalId",
    li."createdBy",
    li."createdAt",
    li."updatedBy",
    li."updatedAt",
    ss."supersessionMode"
   FROM tool t
     JOIN latest_items li(id, "readableId", name, description, type, "replenishmentSystem", "defaultMethodType", "itemTrackingType", "unitOfMeasureCode", active, "companyId", "createdBy", "createdAt", "updatedBy", "updatedAt", assignee, "modelUploadId", "thumbnailPath", notes, "trackingMethod", embedding, revision, "readableIdWithRevision", "requiresInspection", "sourcingType", "modelUploadId_1", "modelPath", "modelThumbnailPath", "modelName", "modelSize") ON li."readableId" = t.id AND li."companyId" = t."companyId"
     LEFT JOIN item_revisions ir ON ir."readableId" = t.id AND ir."companyId" = li."companyId"
     LEFT JOIN ( SELECT ps_1."itemId",
            ps_1."companyId",
            string_agg(ps_1."supplierPartId", ','::text) AS "supplierIds"
           FROM "supplierPart" ps_1
          GROUP BY ps_1."itemId", ps_1."companyId") ps ON ps."itemId" = li.id AND ps."companyId" = li."companyId"
     LEFT JOIN "unitOfMeasure" uom ON uom.code = li."unitOfMeasureCode" AND uom."companyId" = li."companyId"
     LEFT JOIN "itemCost" ic ON ic."itemId" = li.id
     LEFT JOIN "itemSupersession" ss ON ss."itemId" = li.id AND ss."companyId" = li."companyId";

CREATE OR REPLACE VIEW "consumables" WITH (security_invoker = true) AS
 WITH latest_items AS (
         SELECT DISTINCT ON (i."readableId", i."companyId") i.id,
            i."readableId",
            i.name,
            i.description,
            i.type,
            i."replenishmentSystem",
            i."defaultMethodType",
            i."itemTrackingType",
            i."unitOfMeasureCode",
            i.active,
            i."companyId",
            i."createdBy",
            i."createdAt",
            i."updatedBy",
            i."updatedAt",
            i.assignee,
            i."modelUploadId",
            i."thumbnailPath",
            i.notes,
            i."trackingMethod",
            i.embedding,
            i.revision,
            i."readableIdWithRevision",
            i."requiresInspection",
            mu."modelPath",
            mu."thumbnailPath" AS "modelThumbnailPath",
            mu.name AS "modelName",
            mu.size AS "modelSize"
           FROM item i
             LEFT JOIN "modelUpload" mu ON mu.id = i."modelUploadId"
          WHERE i.type = 'Consumable'::"itemType"
          ORDER BY i."readableId", i."companyId", (
                CASE
                    WHEN i.revision = '0'::text OR i.revision = ''::text OR i.revision IS NULL THEN 0
                    ELSE 1
                END) DESC, i."createdAt" DESC NULLS LAST
        ), item_revisions AS (
         SELECT i."readableId",
            i."companyId",
            json_agg(json_build_object('id', i.id, 'revision', i.revision, 'methodType', i."defaultMethodType", 'type', i.type) ORDER BY (
                CASE
                    WHEN i.revision = '0'::text OR i.revision = ''::text OR i.revision IS NULL THEN 0
                    ELSE 1
                END), i."createdAt") AS revisions
           FROM item i
          WHERE i.type = 'Consumable'::"itemType"
          GROUP BY i."readableId", i."companyId"
        )
 SELECT li.active,
    li.assignee,
    li."defaultMethodType",
    li.description,
    li."itemTrackingType",
    li.name,
    li."replenishmentSystem",
    li."unitOfMeasureCode",
    li.notes,
    li.revision,
    li."readableId",
    li."readableIdWithRevision",
    li.id,
    li."companyId",
        CASE
            WHEN li."thumbnailPath" IS NULL AND li."modelThumbnailPath" IS NOT NULL THEN li."modelThumbnailPath"
            ELSE li."thumbnailPath"
        END AS "thumbnailPath",
    li."modelUploadId",
    li."modelPath",
    li."modelName",
    li."modelSize",
    ps."supplierIds",
    uom.name AS "unitOfMeasure",
    ir.revisions,
    c."customFields",
    c.tags,
    ic."itemPostingGroupId",
    ( SELECT COALESCE(jsonb_object_agg(eim.integration,
                CASE
                    WHEN eim.metadata IS NOT NULL THEN eim.metadata
                    ELSE to_jsonb(eim."externalId")
                END) FILTER (WHERE eim."externalId" IS NOT NULL OR eim.metadata IS NOT NULL), '{}'::jsonb) AS "coalesce"
           FROM "externalIntegrationMapping" eim
          WHERE eim."entityType" = 'item'::text AND eim."entityId" = li.id) AS "externalId",
    li."createdBy",
    li."createdAt",
    li."updatedBy",
    li."updatedAt",
    ss."supersessionMode"
   FROM consumable c
     JOIN latest_items li ON li."readableId" = c.id AND li."companyId" = c."companyId"
     LEFT JOIN item_revisions ir ON ir."readableId" = c.id AND ir."companyId" = li."companyId"
     LEFT JOIN ( SELECT ps_1."itemId",
            ps_1."companyId",
            string_agg(ps_1."supplierPartId", ','::text) AS "supplierIds"
           FROM "supplierPart" ps_1
          GROUP BY ps_1."itemId", ps_1."companyId") ps ON ps."itemId" = li.id AND ps."companyId" = li."companyId"
     LEFT JOIN "unitOfMeasure" uom ON uom.code = li."unitOfMeasureCode" AND uom."companyId" = li."companyId"
     LEFT JOIN "itemCost" ic ON ic."itemId" = li.id
     LEFT JOIN "itemSupersession" ss ON ss."itemId" = li.id AND ss."companyId" = li."companyId";
