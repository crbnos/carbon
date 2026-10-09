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
import type {
  BuildFromPartArgs,
  BuildFromPartPreviewRow
} from "~/modules/projects/projects.server";
import {
  buildElementsFromPart,
  previewBuildFromPart
} from "~/modules/projects/projects.server";
import { getDatabaseClient } from "~/services/database.server";

const logger = getLogger("erp", "project-build-from-part");

export type BuildFromPartPreview = {
  templates: { id: string; name: string; identifier: string | null }[];
  preview: { rows: BuildFromPartPreviewRow[]; skippedLines: number } | null;
  error: string | null;
};

export type BuildFromPartResult = {
  count?: number;
  skippedLines?: number;
  error?: { message: string } | null;
};

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
 * The company's project templates and, when the query names a complete
 * source, the elements a build would create (no insert).
 */
export async function loader({
  request,
  params
}: LoaderFunctionArgs): Promise<BuildFromPartPreview> {
  const { client, companyId } = await requirePermissions(request, {
    view: "projects"
  });
  const { projectId } = params;
  if (!projectId) throw new Error("Could not find projectId");

  const templates = await client
    .from("project")
    .select("id, name, identifier")
    .eq("companyId", companyId)
    .eq("projectType", "Standard")
    .eq("isTemplate", true)
    .neq("id", projectId)
    .order("name");
  if (templates.error) {
    logger.error("Failed to load the project templates", {
      companyId,
      projectId,
      error: templates.error
    });
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
      toBuildArgs(validation.data, companyId, projectId)
    );
    return { templates: templates.data ?? [], preview, error: null };
  } catch (error) {
    logger.error("Failed to preview Build from part", {
      companyId,
      projectId,
      error
    });
    return {
      templates: templates.data ?? [],
      preview: null,
      error: getErrorMessage(error, "The source could not be read")
    };
  }
}

/** Creates the planned elements under the chosen parent. */
export async function action({
  request,
  params
}: ActionFunctionArgs): Promise<BuildFromPartResult> {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "projects"
  });
  const { projectId } = params;
  if (!projectId) throw new Error("Could not find projectId");

  const validation = await validator(buildFromPartValidator).validate(
    await request.formData()
  );
  if (validation.error) {
    return { error: { message: "Choose a source to build from" } };
  }

  try {
    const result = await buildElementsFromPart(client, getDatabaseClient(), {
      ...toBuildArgs(validation.data, companyId, projectId),
      userId
    });
    return { ...result, error: null };
  } catch (error) {
    logger.error("Failed to build elements from a part", {
      companyId,
      projectId,
      error
    });
    return {
      error: {
        message: getErrorMessage(error, "The elements could not be created")
      }
    };
  }
}
