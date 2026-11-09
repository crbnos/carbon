// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Button,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  HStack,
  useDisclosure,
  useRouteDialog
} from "@carbon/react";
import { msg } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { LuPlus } from "react-icons/lu";
import { usePermissions, useRouteData } from "~/hooks";
import {
  IndirectRatesGrid,
  SetIndirectRateModal
} from "~/modules/accounting/ui/IndirectRates";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import type { loader as indirectRatesLoader } from "./indirect-rates";

export const handle: Handle = {
  breadcrumb: msg`Rates`
};

/**
 * The year-to-date rate of every pool and rate type of the page's fiscal
 * year, in a drawer over the runs. It reads the page's loader data. Set Rate
 * enters a Provisional, Target or Final rate from a period to the end of the
 * year; Actual rates come from the period run only.
 */
export default function IndirectRatesRatesRoute() {
  const routeData = useRouteData<
    Awaited<ReturnType<typeof indirectRatesLoader>>
  >(path.to.indirectRates);
  const dialog = useRouteDialog(
    `${path.to.indirectRates}?fiscalYear=${routeData?.fiscalYear}`
  );
  const permissions = usePermissions();
  const settingRate = useDisclosure();

  if (!routeData) return null;
  const { fiscalYear, pools, rates, startMonth } = routeData;
  const activePools = pools.filter((pool) => pool.active);

  return (
    <Drawer
      open={dialog.open}
      onOpenChange={(open) => {
        if (!open) dialog.close();
      }}
    >
      <DrawerContent size="xl">
        <DrawerHeader>
          <HStack className="w-full justify-between gap-2 pr-8">
            <div className="flex flex-col gap-1">
              <DrawerTitle>
                <Trans>Rates, FY{fiscalYear}</Trans>
              </DrawerTitle>
              <DrawerDescription>
                <Trans>
                  The year-to-date rate of each pool. Actual rates come from the
                  period run.
                </Trans>
              </DrawerDescription>
            </div>
            <Button
              variant="secondary"
              leftIcon={<LuPlus />}
              isDisabled={
                !permissions.can("update", "accounting") ||
                activePools.length === 0
              }
              onClick={settingRate.onOpen}
            >
              <Trans>Set Rate</Trans>
            </Button>
          </HStack>
        </DrawerHeader>
        <DrawerBody>
          <IndirectRatesGrid
            pools={pools}
            rates={rates}
            startMonth={startMonth}
          />
        </DrawerBody>
      </DrawerContent>
      <SetIndirectRateModal
        open={settingRate.isOpen}
        pools={activePools}
        fiscalYear={fiscalYear}
        action={path.to.indirectRates}
        onClose={settingRate.onClose}
      />
    </Drawer>
  );
}
