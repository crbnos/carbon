// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import { useCloseRoute } from "@carbon/react";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { serviceTemplateValidator } from "~/modules/service";
import { createServiceTemplate } from "~/modules/service/service.server";
import ServiceTemplateForm from "~/modules/service/ui/Templates/ServiceTemplateForm";
import { getDatabaseClient } from "~/services/database.server";
import { path } from "~/utils/path";

const logger = getLogger("erp", "service-template-new");

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, { create: "service" });
  return null;
}

/** Creates a service template and opens it to build its work. */
export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    create: "service"
  });

  const validation = await validator(serviceTemplateValidator).validate(
    await request.formData()
  );
  if (validation.error) return validationError(validation.error);

  let templateId: string;
  try {
    const template = await createServiceTemplate(getDatabaseClient(), {
      ...validation.data,
      companyId,
      userId
    });
    templateId = template.id;
  } catch (err) {
    logger.error("Failed to create a service template", {
      companyId,
      error: err
    });
    throw redirect(
      path.to.serviceTemplates,
      await flash(request, error(err, "Failed to create the service template"))
    );
  }

  throw redirect(
    path.to.serviceTemplate(templateId),
    await flash(request, success("Service template created"))
  );
}

export default function NewServiceTemplateRoute() {
  const closeRoute = useCloseRoute();
  return <ServiceTemplateForm onClose={() => closeRoute()} />;
}
