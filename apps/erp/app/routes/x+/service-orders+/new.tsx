// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate } from "react-router";
import { useUser } from "~/hooks";
import { serviceOrderValidator } from "~/modules/service/service.models";
import {
  createServiceOrder,
  ServiceOrderError
} from "~/modules/service/service.server";
import { getServiceOrderFormOptions } from "~/modules/service/service.service";
import { ServiceOrderForm } from "~/modules/service/ui/ServiceOrders";
import { getDatabaseClient } from "~/services/database.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

const logger = getLogger("erp", "service-order-new");

export const handle: Handle = {
  breadcrumb: msg`Service Orders`,
  to: path.to.serviceOrders
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    create: "service"
  });

  const options = await getServiceOrderFormOptions(client, companyId);
  if (options.error) {
    logger.error("Failed to load the service order form", {
      companyId,
      error: options.error
    });
  }

  return {
    customerAssetId: new URL(request.url).searchParams.get("customerAssetId"),
    options: {
      assets: options.assets,
      contracts: options.contracts,
      templates: options.templates
    }
  };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "service"
  });

  const formData = await request.formData();
  const validation = await validator(serviceOrderValidator).validate(formData);
  if (validation.error) {
    return validationError(validation.error);
  }

  let order: { id: string; serviceOrderId: string };
  try {
    order = await createServiceOrder(client, getDatabaseClient(), {
      ...validation.data,
      companyId,
      userId
    });
  } catch (err) {
    if (err instanceof ServiceOrderError) {
      // A refusal is about the subject: the unit, or the refurbished serial.
      return validationError({
        fieldErrors: {
          [validation.data.type === "Refurbishment"
            ? "trackedEntityId"
            : "customerAssetId"]: err.message
        }
      });
    }
    logger.error("Failed to create the service order", {
      companyId,
      error: err
    });
    throw redirect(
      path.to.serviceOrders,
      await flash(request, error(err, "Failed to create the service order"))
    );
  }

  throw redirect(
    path.to.serviceOrderDetails(order.id),
    await flash(request, success(`Created ${order.serviceOrderId}`))
  );
}

export default function NewServiceOrderRoute() {
  const { customerAssetId, options } = useLoaderData<typeof loader>();
  const { defaults } = useUser();
  const navigate = useNavigate();

  return (
    <ServiceOrderForm
      initialValues={{
        type: "Field Visit",
        customerAssetId: customerAssetId ?? "",
        locationId: defaults?.locationId ?? "",
        priority: "None",
        startFrom: "Empty"
      }}
      options={options}
      onClose={() => navigate(path.to.serviceOrders)}
    />
  );
}
