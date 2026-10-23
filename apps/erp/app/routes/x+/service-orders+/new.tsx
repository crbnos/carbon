// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validationError, validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import { msg } from "@lingui/core/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate } from "react-router";
import { useUser } from "~/hooks";
import { serviceOrderValidator } from "~/modules/service/service.models";
import { getServiceOrderFormOptions } from "~/modules/service/service.service";
import { ServiceOrderForm } from "~/modules/service/ui/ServiceOrders";
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

export async function action(args: ActionFunctionArgs) {
  const input = await validator(serviceOrderValidator).request(args);
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  const result = await api.service.createServiceOrder(input.data);
  // A refusal is about the subject: the unit, or the refurbished serial.
  if (result.error?.category === "rule") {
    return validationError({
      fieldErrors: {
        [input.data.type === "Refurbishment"
          ? "trackedEntityId"
          : "customerAssetId"]: result.error.message
      }
    });
  }
  if (!result.data) {
    return respond(args.request, result).redirect(path.to.serviceOrders);
  }
  return respond(args.request, result).redirect(
    path.to.serviceOrderDetails(result.data.id),
    { message: `Created ${result.data.serviceOrderId}` }
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
