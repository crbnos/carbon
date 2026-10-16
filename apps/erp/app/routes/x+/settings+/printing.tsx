// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import type { PrintingSettings } from "@carbon/printing";
import { getPrinterRoutes, updateAssignmentValidator } from "@carbon/printing";
import { Button, RecordOutlet, ScrollArea } from "@carbon/react";
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { LuPrinter } from "react-icons/lu";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";
import { z } from "zod";
import { SettingsPage, SettingsPageHeading } from "~/components/SettingsPage";
import {
  getLocationsList,
  getWorkCentersList
} from "~/modules/resources/resources.service";
import { printerRouteValidator } from "~/modules/settings/settings.models";
import { getCompanySettings } from "~/modules/settings/settings.service";
import { AssignmentsCard, PrintersCard } from "~/modules/settings/ui/Printing";
import { getUserDefaults } from "~/modules/users/users.service";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Printing`,
  to: path.to.printingSettings
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    view: "settings"
  });

  const [companySettings, printerRoutes, workCenters, locations, userDefaults] =
    await Promise.all([
      getCompanySettings(client, companyId),
      getPrinterRoutes(client, companyId),
      getWorkCentersList(client, companyId),
      getLocationsList(client, companyId),
      getUserDefaults(client, userId, companyId)
    ]);

  if (!companySettings.data)
    throw redirect(
      path.to.settings,
      await flash(
        request,
        error(companySettings.error, "Failed to get company settings")
      )
    );

  return {
    printing:
      (companySettings.data.printing as PrintingSettings | null) ?? null,
    printerRoutes: printerRoutes.data ?? [],
    workCenters: workCenters.data ?? [],
    locations: locations.data ?? [],
    defaultLocationId: userDefaults.data?.locationId ?? null
  };
}

// The cards post one intent each: a printer route's save or test print, or a
// printer assignment.
const printingForm = z.discriminatedUnion("intent", [
  printerRouteValidator.safeExtend({ intent: z.literal("upsertRoute") }),
  z.object({
    intent: z.literal("testPrint"),
    routeId: z.string().min(1, { message: "Route ID required" })
  }),
  updateAssignmentValidator.safeExtend({
    intent: z.literal("updateAssignment")
  })
]);

export async function action(args: ActionFunctionArgs) {
  const input = await validator(printingForm).request(args);
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  switch (input.data.intent) {
    case "upsertRoute":
      return api.settings.savePrinterRoute(input.data);
    case "testPrint":
      return api.settings.testPrinterRoute(input.data);
    case "updateAssignment":
      return api.settings.assignPrinter(input.data);
  }
}

export default function PrintingSettingsRoute() {
  const { printing, printerRoutes, workCenters, locations } =
    useLoaderData<typeof loader>();

  return (
    <ScrollArea className="w-full h-[calc(100dvh-var(--topbar-height)-var(--content-inset))]">
      <SettingsPage className="gap-4">
        <div className="flex items-center justify-between w-full max-md:justify-end">
          <SettingsPageHeading>
            <Trans>Printing</Trans>
          </SettingsPageHeading>
          <Button variant="secondary" leftIcon={<LuPrinter />} asChild>
            <Link to={path.to.printingSettingsJobs}>
              <Trans>View Prints</Trans>
            </Link>
          </Button>
        </div>

        <PrintersCard printerRoutes={printerRoutes} />

        <AssignmentsCard
          printing={printing}
          printerRoutes={printerRoutes}
          locations={locations}
          workCenters={workCenters}
        />
      </SettingsPage>
      <RecordOutlet />
    </ScrollArea>
  );
}
