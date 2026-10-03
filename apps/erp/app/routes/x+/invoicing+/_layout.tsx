// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { VStack } from "@carbon/react";
import { isUnaffectedByNavigation } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import type {
  LoaderFunctionArgs,
  MetaFunction,
  ShouldRevalidateFunction
} from "react-router";
import { Outlet } from "react-router";
import { GroupedContentSidebar } from "~/components/Layout";
import useInvoicingSubmodules from "~/modules/invoicing/ui/useInvoicingSubmodules";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const meta: MetaFunction = () => {
  return [{ title: "Carbon | Invoicing" }];
};

function InvoicingSidebar() {
  const { groups } = useInvoicingSubmodules();
  return <GroupedContentSidebar groups={groups} />;
}

export const handle: Handle = {
  breadcrumb: msg`Invoicing`,
  to: path.to.invoicing,
  module: "invoicing",
  sidebar: InvoicingSidebar
};

export const shouldRevalidate: ShouldRevalidateFunction = (args) =>
  isUnaffectedByNavigation(args) ? false : args.defaultShouldRevalidate;

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "invoicing"
  });

  return null;
}

export default function InvoicingRoute() {
  return (
    <VStack spacing={0} className="h-full">
      <Outlet />
    </VStack>
  );
}
