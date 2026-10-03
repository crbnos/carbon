// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { isUnaffectedByNavigation } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import type {
  LoaderFunctionArgs,
  MetaFunction,
  ShouldRevalidateFunction
} from "react-router";
import { Outlet } from "react-router";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export { RouteErrorBoundary as ErrorBoundary } from "@carbon/react/ErrorBoundary";

export const meta: MetaFunction = () => {
  return [{ title: "Carbon | Inspection" }];
};

export const shouldRevalidate: ShouldRevalidateFunction = (args) =>
  isUnaffectedByNavigation(args) ? false : args.defaultShouldRevalidate;

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "quality"
  });

  return null;
}

export const handle: Handle = {
  breadcrumb: msg`Quality`,
  to: path.to.quality,
  module: "quality"
};

export default function InspectionRoute() {
  return <Outlet />;
}
