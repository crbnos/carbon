// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { notFound } from "@carbon/auth";
import { validator } from "@carbon/form";
import { useRouteDialog } from "@carbon/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useParams } from "react-router";
import { customerLocationTransitTimeValidator } from "~/modules/sales/sales.models";
import { CustomerTransitTimeForm } from "~/modules/sales/ui/Customer";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { transitTimeId } = params;
  if (!transitTimeId) throw notFound("transitTimeId not found");
  const api = await carbon(request);
  const transitTime = await api.sales.getCustomerLocationTransitTime({
    id: transitTimeId
  });
  if (transitTime.error || !transitTime.data) {
    throw notFound("The transit time could not be found");
  }
  return { transitTime: transitTime.data };
}

export async function action(args: ActionFunctionArgs) {
  const input = await validator(customerLocationTransitTimeValidator).request(
    args,
    { params: ["customerId", "transitTimeId"] }
  );
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  const result = await api.sales.updateCustomerLocationTransitTime({
    ...input.data,
    id: input.params.transitTimeId,
    customerId: input.params.customerId
  });
  // An error is toasted and the drawer stays open.
  if (result.error) return result;
  return respond(args.request, result).redirect(
    path.to.customerShipping(input.params.customerId),
    { message: "Saved transit time" }
  );
}

export default function EditCustomerTransitTimeRoute() {
  const { customerId } = useParams();
  if (!customerId) throw new Error("customerId not found");
  const { transitTime } = useLoaderData<typeof loader>();
  const dialog = useRouteDialog(path.to.customerShipping(customerId));

  return (
    <CustomerTransitTimeForm
      key={transitTime.id}
      customerId={customerId}
      initialValues={{
        id: transitTime.id,
        customerLocationId: transitTime.customerLocationId,
        shippingMethodId: transitTime.shippingMethodId,
        transitDays: transitTime.transitDays
      }}
      open={dialog.open}
      onClose={dialog.close}
    />
  );
}
