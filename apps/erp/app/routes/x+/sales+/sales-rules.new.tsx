// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { respond } from "@carbon/api/carbon.server";
import { authorize } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import { useRouteDialog } from "@carbon/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { salesRuleValidator } from "~/modules/sales/sales.models";
import { SalesRuleForm } from "~/modules/sales/ui/SalesRules";
import { getParams, path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  await authorize(request, { "sales.salesRules": "Create" });
  return {};
}

export async function action(args: ActionFunctionArgs) {
  const input = await validator(salesRuleValidator).request(args);
  if ("invalid" in input) return input.invalid;
  const { api } = await authorize(args.request);
  const result = await api.sales.createSalesRule(input.data);
  return respond(args.request, result).redirect(
    `${path.to.salesRules}?${getParams(args.request)}`
  );
}

export default function NewSalesRuleRoute() {
  // navigate(-1) breaks when the page was opened directly (no history entry
  // to pop). Always navigate forward to the parent list route — closes the
  // drawer regardless of how the user got here.
  const dialog = useRouteDialog(path.to.salesRules);
  return (
    <SalesRuleForm
      initialValues={{}}
      open={dialog.open}
      onClose={dialog.close}
    />
  );
}
