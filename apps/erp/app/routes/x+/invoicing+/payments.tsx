// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { PaymentsTable } from "~/modules/invoicing/ui";
import type { Handle } from "~/utils/handle";
import { paymentsList } from "~/utils/list-registry/invoicing.server";
import { loadListPage } from "~/utils/list-registry/load.server";
import { path } from "~/utils/path";

export const handle: Handle = {
  realtime: ["payment"],
  breadcrumb: msg`Payments`,
  to: path.to.payments,
  module: "invoicing"
};

export async function loader({ request }: LoaderFunctionArgs) {
  return loadListPage(request, paymentsList, {
    dataKey: "payments",
    onError: {
      redirectTo: path.to.invoicing,
      message: "Failed to fetch payments"
    }
  });
}

export default function PaymentsRoute() {
  const { count, payments, infinite } = useLoaderData<typeof loader>();
  return <PaymentsTable data={payments} count={count} infinite={infinite} />;
}
