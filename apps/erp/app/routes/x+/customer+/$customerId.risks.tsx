// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "react-router";
import { data, useParams } from "react-router";
import CustomerRiskRegister from "~/modules/sales/ui/Customer/CustomerRiskRegister";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "sales"
  });

  return data({});
}

export default function CustomerRisksRoute() {
  const { customerId } = useParams();
  if (!customerId) throw new Error("Could not find customerId");

  return <CustomerRiskRegister customerId={customerId} />;
}
