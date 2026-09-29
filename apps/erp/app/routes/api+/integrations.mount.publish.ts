import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getMountIntegration } from "@carbon/ee/mount.server";
import { trigger } from "@carbon/jobs";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { z } from "zod";

const logger = getLogger("erp", "integrations-mount-publish");

export const config = {
  runtime: "nodejs"
};

const PublishRequestSchema = z.object({
  entityType: z.enum(["customer", "supplier", "item"])
});

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId } = await requirePermissions(request, {
    update: "settings"
  });

  const parsed = PublishRequestSchema.safeParse({
    entityType: new URL(request.url).searchParams.get("entityType")
  });

  if (!parsed.success) {
    return data({ error: "Invalid entity type" }, { status: 400 });
  }

  const integration = await getMountIntegration(client, companyId);

  if (integration.error || !integration.data?.[0]?.active) {
    return data(
      { error: "Mount integration not found or inactive" },
      { status: 400 }
    );
  }

  try {
    await trigger("mount-publish", {
      companyId,
      entityTypes: [parsed.data.entityType]
    });

    return data({ success: true, message: "Mount publish started" });
  } catch (error) {
    logger.error("Failed to start Mount publish", {
      companyId,
      entityType: parsed.data.entityType,
      error
    });
    return data({ error: "Failed to start Mount publish" }, { status: 500 });
  }
}
