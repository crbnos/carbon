// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import { useRouteDialog } from "@carbon/react";
import type { ActionFunctionArgs } from "react-router";
import { useParams } from "react-router";
import { customerLocationTransitTimeValidator } from "~/modules/sales/sales.models";
import { CustomerTransitTimeForm } from "~/modules/sales/ui/Customer";
import { path } from "~/utils/path";

export async function action(args: ActionFunctionArgs) {
  const input = await validator(customerLocationTransitTimeValidator).request(
    args,
    { params: ["customerId"] }
  );
  if ("invalid" in input) return input.invalid;
  const { id: _, ...transitTime } = input.data;
  const api = await carbon(args.request);
  const result = await api.sales.upsertCustomerLocationTransitTime({
    ...transitTime,
    customerId: input.params.customerId
  });
  // An error is toasted and the drawer stays open.
  if (result.error) return result;
  return respond(args.request, result).redirect(
    path.to.customerShipping(input.params.customerId),
    { message: "Saved transit time" }
  );
}

export default function NewCustomerTransitTimeRoute() {
  const { customerId } = useParams();
  if (!customerId) throw new Error("customerId not found");
  const dialog = useRouteDialog(path.to.customerShipping(customerId));

  return (
    <CustomerTransitTimeForm
      customerId={customerId}
      initialValues={{
        customerLocationId: "",
        shippingMethodId: "",
        transitDays: 0
      }}
      open={dialog.open}
      onClose={dialog.close}
    />
  );
}
