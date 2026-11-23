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
import { getCurrentFiscalYear } from "~/modules/accounting/accounting.service";
import { IceExport } from "~/modules/accounting/ui/IndirectRates";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`ICE Export`
};

/** The incurred cost submission schedules of one fiscal year (`?fiscalYear`,
 *  else the current one). */
export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "accounting",
    role: "employee"
  });

  // A missing or bad `?fiscalYear` opens the current fiscal year, as the
  // Indirect Rates page does.
  const raw = Number(new URL(request.url).searchParams.get("fiscalYear"));
  const fiscalYear =
    Number.isInteger(raw) && raw >= 1900 && raw <= 9999
      ? raw
      : (await getCurrentFiscalYear(client, companyId)).fiscalYear;

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
