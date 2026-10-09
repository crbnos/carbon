// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs } from "react-router";
import {
  deleteProjectView,
  type ProjectDisplayState,
  projectDisplayStateValidator,
  projectViewValidator,
  upsertProjectUserPreference,
  upsertProjectView
} from "~/modules/projects";

const logger = getLogger("erp", "project-views");

export type ProjectViewsActionData = {
  success: boolean;
  id?: string;
  message?: string;
};

function parseState(value: FormDataEntryValue | null): ProjectDisplayState {
  let raw: unknown = {};
  try {
    raw = JSON.parse(typeof value === "string" ? value : "{}");
  } catch {
    raw = {};
  }
  return projectDisplayStateValidator.parse(
    raw && typeof raw === "object" ? raw : {}
  );
}

/**
 * Saved views and the user's preference on the Elements page. `intent` picks
 * the change: `savePreference` keeps the user's current state, `upsertView`
 * saves or updates a view, `deleteView` deletes one. RLS lets a user write only
 * their own rows.
 */
export async function action({
  request,
  params
}: ActionFunctionArgs): Promise<ProjectViewsActionData> {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    view: "projects"
  });

  const { projectId } = params;
  if (!projectId) throw new Error("Could not find projectId");

  const formData = await request.formData();
  const intent = formData.get("intent");

  switch (intent) {
    case "savePreference": {
      const state = parseState(formData.get("state"));
      const result = await upsertProjectUserPreference(client, {
        ...state,
        projectId,
        companyId,
        userId
      });
      if (result.error) {
        logger.error("Failed to save the element page preference", {
          companyId,
          projectId,
          error: result.error
        });
        return { success: false, message: "Failed to save your preference" };
      }
      return { success: true };
    }
    case "upsertView": {
      const validation =
        await validator(projectViewValidator).validate(formData);
      if (validation.error) {
        return { success: false, message: "A view needs a name" };
      }
      const { id, name, isShared, state } = validation.data;
      const result = await upsertProjectView(client, {
        ...parseState(state),
        id,
        name,
        isShared,
        projectId,
        companyId,
        userId
      });
      if (result.error || !result.data) {
        logger.error("Failed to save a project view", {
          companyId,
          projectId,
          error: result.error
        });
        return {
          success: false,
          message:
            result.error?.code === "23505"
              ? "You already have a view with this name"
              : "Failed to save the view"
        };
      }
      return { success: true, id: result.data.id, message: "View saved" };
    }
    case "deleteView": {
      const id = formData.get("id");
      if (typeof id !== "string" || !id) {
        return { success: false, message: "Choose a view" };
      }
      const result = await deleteProjectView(client, {
        id,
        projectId,
        companyId,
        userId
      });
      if (result.error) {
        logger.error("Failed to delete a project view", {
          companyId,
          projectId,
          error: result.error
        });
        return { success: false, message: "Failed to delete the view" };
      }
      return { success: true, message: "View deleted" };
    }
    default:
      return { success: false, message: "Unknown intent" };
  }
}
