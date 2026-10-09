// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import { getErrorMessage } from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import type { z } from "zod";
import { buildFromPartValidator } from "~/modules/projects";
import type { BuildFromPartArgs } from "~/modules/projects/projects.server";
import {
  buildElementsFromPart,
  previewBuildFromPart
} from "~/modules/projects/projects.server";
import type {
  BuildFromPartPreview,
  BuildFromPartResult
} from "~/routes/x+/project+/$projectId.elements.build";
import { getDatabaseClient } from "~/services/database.server";

const logger = getLogger("erp", "service-order-build-tree");

async function orderProjectId(
  client: Awaited<ReturnType<typeof requirePermissions>>["client"],
  id: string,
  companyId: string
) {
  const order = await client
    .from("serviceOrder")
    .select("projectId, status")
    .eq("id", id)
    .eq("companyId", companyId)
    .single();
  return order.data;
}

function toBuildArgs(
  data: z.infer<typeof buildFromPartValidator>,
  companyId: string,
  projectId: string
): BuildFromPartArgs {
  return {
    companyId,
    projectId,
    parentId: data.parentId ?? null,
    depth: data.depth,
    includeBought: data.includeBought,
    source:
      data.source === "Serial"
        ? { trackedEntityId: data.trackedEntityId! }
        : data.source === "Item"
          ? { itemId: data.itemId! }
          : { templateProjectId: data.templateProjectId! }
  };
}

/**
 * Build Tree for a service order: the service templates and, when the query
 * names a complete source, the nodes a build would create (no insert).
 */
export async function loader({
  request,
  params
}: LoaderFunctionArgs): Promise<BuildFromPartPreview> {
  const { client, companyId } = await requirePermissions(request, {
    view: "service"
  });
  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const [order, templates] = await Promise.all([
    orderProjectId(client, id, companyId),
    client
      .from("project")
      .select("id, name, identifier")
      .eq("companyId", companyId)
      .eq("projectType", "Service")
      .eq("isTemplate", true)
      .order("name")
  ]);
  if (!order) {
    return {
      templates: [],
      preview: null,
      error: "The service order was not found"
    };
  }

  const validation = await validator(buildFromPartValidator).validate(
    new URL(request.url).searchParams
  );
  if (validation.error) {
    return { templates: templates.data ?? [], preview: null, error: null };
  }

  try {
    const preview = await previewBuildFromPart(
      client,
      getDatabaseClient(),
      toBuildArgs(validation.data, companyId, order.projectId)
    );
    return { templates: templates.data ?? [], preview, error: null };
  } catch (err) {
    logger.error("Failed to preview Build Tree", {
      companyId,
      serviceOrderId: id,
      error: err
    });
    return {
      templates: templates.data ?? [],
      preview: null,
      error: getErrorMessage(err, "The source could not be read")
    };
  }
}

/** Creates the planned nodes under the chosen parent. */
export async function action({
  request,
  params
}: ActionFunctionArgs): Promise<BuildFromPartResult> {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "service"
  });
  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const order = await orderProjectId(client, id, companyId);
  if (!order) return { error: { message: "The service order was not found" } };
  if (order.status === "Closed" || order.status === "Cancelled") {
    return {
      error: { message: "A closed or cancelled service order cannot change" }
    };
  }

  const validation = await validator(buildFromPartValidator).validate(
    await request.formData()
  );
  if (validation.error) {
    return { error: { message: "Choose a source to build from" } };
  }

  try {
    const result = await buildElementsFromPart(client, getDatabaseClient(), {
      ...toBuildArgs(validation.data, companyId, order.projectId),
      includePlanLines: true,
      userId
    });
    return { ...result, error: null };
  } catch (err) {
    logger.error("Failed to build the work tree", {
      companyId,
      serviceOrderId: id,
      error: err
    });
    return {
      error: {
        message: getErrorMessage(err, "The nodes could not be created")
      }
    };
  }
}
