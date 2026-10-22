// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import { getErrorMessage } from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { buildFromPartValidator } from "~/modules/projects/projects.models";
import { previewBuildFromPart } from "~/modules/projects/projects.service";
import { serviceBuildArgs } from "~/modules/service/service.service";
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
      serviceBuildArgs(validation.data, companyId, order.projectId)
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
export async function action(args: ActionFunctionArgs) {
  const input = await validator().request(args, { params: ["id"] });
  if ("invalid" in input) return input.invalid;
  const validation = await validator(buildFromPartValidator).validate(
    await args.request.formData()
  );
  if (validation.error) {
    return {
      error: { message: "Choose a source to build from" }
    } satisfies BuildFromPartResult;
  }

  const api = await carbon(args.request);
  const result = await api.service.buildServiceOrderWork({
    ...validation.data,
    serviceOrderId: input.params.id
  });
  if (result.error) {
    return {
      error: { message: result.error.message }
    } satisfies BuildFromPartResult;
  }
  return { ...result.data, error: null } satisfies BuildFromPartResult;
}
