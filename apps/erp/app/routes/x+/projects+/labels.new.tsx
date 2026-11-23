// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  projectLabelDefaultColor,
  projectLabelValidator
} from "~/modules/projects/projects.models";
import { upsertProjectLabel } from "~/modules/projects/projects.service";

const logger = getLogger("erp", "project-label-new");

/**
 * Creates a company label from a labels picker, by name: "Create …" in an
 * element's labels. It takes the default color, changed in Settings →
 * Projects. Project and service work share the labels.
 */
export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "projects"
  });

  const formData = await request.formData();
  if (!formData.get("color")) formData.set("color", projectLabelDefaultColor);
  const validation = await validator(projectLabelValidator).validate(formData);
  if (validation.error) {
    return data(
      {
        error: {
          message:
            Object.values(validation.error.fieldErrors ?? {})[0] ??
            "Invalid label"
        }
      },
      { status: 400 }
    );
  }

  const { id: _id, ...label } = validation.data;
  const created = await upsertProjectLabel(client, {
    ...label,
    companyId,
    createdBy: userId
  });
  if (created.error || !created.data) {
    if (created.error?.code !== "23505") {
      logger.error("Failed to create a project label", {
        companyId,
        error: created.error
      });
    }
    return data(
      {
        error: {
          message:
            created.error?.code === "23505"
              ? "A label with this name already exists"
              : "Failed to create the label"
        }
      },
      { status: 400 }
    );
  }

  return data({ id: created.data.id }, { status: 201 });
}
