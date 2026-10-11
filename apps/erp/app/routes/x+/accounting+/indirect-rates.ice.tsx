// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle
} from "@carbon/react";
import { msg } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate } from "react-router";
import { IceExport } from "~/modules/accounting/ui/IndirectRates";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`ICE Export`
};

/** The incurred cost submission schedules of one fiscal year (`?fiscalYear`). */
export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "accounting",
    role: "employee"
  });

  const fiscalYear = Number(
    new URL(request.url).searchParams.get("fiscalYear")
  );
  if (!Number.isInteger(fiscalYear) || fiscalYear < 1900 || fiscalYear > 9999) {
    throw new Response("Choose a fiscal year", { status: 400 });
  }

  return { fiscalYear };
}

export default function IndirectRatesIceRoute() {
  const { fiscalYear } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const onClose = () =>
    navigate(`${path.to.indirectRates}?fiscalYear=${fiscalYear}`);

  return (
    <Drawer
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DrawerContent size="lg">
        <DrawerHeader>
          <DrawerTitle>
            <Trans>ICE Export, FY{fiscalYear}</Trans>
          </DrawerTitle>
          <DrawerDescription>
            <Trans>
              One CSV per incurred cost schedule. Schedules D, F, J, M, N and O
              need data outside Carbon.
            </Trans>
          </DrawerDescription>
        </DrawerHeader>
        <DrawerBody>
          <IceExport fiscalYear={fiscalYear} />
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  );
}
