// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import { getErrorMessage } from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { buildFromPartValidator } from "~/modules/projects/projects.models";
import {
  type BuildFromPartPreviewRow,
  previewBuildFromPart,
  toBuildFromPartArgs
} from "~/modules/projects/projects.service";
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
      toBuildFromPartArgs(validation.data, companyId, projectId)
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
  const { projectId } = params;
  if (!projectId) throw new Error("Could not find projectId");

  const validation = await validator(buildFromPartValidator).validate(
    await request.formData()
  );
  if (validation.error) {
    return { error: { message: "Choose a source to build from" } };
  }

  const api = await carbon(request);
  const result = await api.projects.buildElementsFromPart({
    ...validation.data,
    projectId
  });
  if (result.error) return { error: { message: result.error.message } };
  return { ...result.data, error: null };
}
