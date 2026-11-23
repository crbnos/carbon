// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { RecordOutlet, VStack } from "@carbon/react";
import type { LoaderFunctionArgs } from "react-router";
import { moduleMeta } from "~/utils/meta";

export { RouteErrorBoundary as ErrorBoundary } from "@carbon/react/ErrorBoundary";

export const meta = moduleMeta("People");

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "people"
  });

  return null;
}

export default function PersonRoute() {
  return (
    <div className="flex h-full w-full justify-center bg-card">
      <VStack spacing={4} className="h-full p-4 w-full max-w-[80rem]">
        <RecordOutlet />
      </VStack>
    </div>
  );
}
