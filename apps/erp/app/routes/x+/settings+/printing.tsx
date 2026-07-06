import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import type { PrintingSettings } from "@carbon/printing";
import {
  getPrinterRoutes,
  getPrintingSettings,
  setContextAssignment,
  updateAssignmentValidator,
  updatePrintingSettings,
  upsertPrinterRoute
} from "@carbon/printing";
import { invalidatePrinterCache } from "@carbon/printing/printing.server";
import { Button, Heading, ScrollArea, VStack } from "@carbon/react";
import { labelSizes } from "@carbon/utils";
import { Trans } from "@lingui/react/macro";
import { LuPrinter } from "react-icons/lu";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Link, Outlet, redirect, useLoaderData } from "react-router";
import { getLocationsList, getWorkCentersList } from "~/modules/resources";
import { getCompanySettings, printerRouteValidator } from "~/modules/settings";
import { AssignmentsCard, PrintersCard } from "~/modules/settings/ui/Printing";
import { getUserDefaults } from "~/modules/users/users.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "Printing",
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

function generateTestLabel(
  format: string,
  mediaSizeId: string | null
): string | null {
  if (format !== "zpl" || !mediaSizeId) return null;

  const labelSize = labelSizes.find((s) => s.id === mediaSizeId);
  if (!labelSize?.zpl) return null;

  const { width, height } = labelSize.zpl;
  const dpi = labelSize.zpl.dpi || 203;
  const widthDots = Math.round(width * dpi);
  const heightDots = Math.round(height * dpi);

  const now = new Date();
  const timestamp = `${now.toLocaleDateString()} ${now.toLocaleTimeString()}`;

  return [
    "^XA",
    `^PW${widthDots}`,
    `^LL${heightDots}`,
    "^MNW",
    "^FO20,20^A0N,30,30^FDTest Print^FS",
    `^FO20,60^A0N,20,20^FD${mediaSizeId} — ${width}x${height}"^FS`,
    `^FO20,90^A0N,16,16^FD${timestamp}^FS`,
    "^XZ"
  ].join("\n");
}

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    update: "settings"
  });

  const formData = await request.formData();
  const intent = formData.get("intent");

  switch (intent) {
    case "upsertRoute": {
      const validation = await validator(printerRouteValidator).validate(
        formData
      );

      if (validation.error) {
        return { success: false, message: "Invalid form data" };
      }

      const result = await upsertPrinterRoute(client, {
        id: validation.data.id || undefined,
        companyId,
        name: validation.data.name,
        format: validation.data.format,
        mediaSizeId: validation.data.mediaSizeId || null,
        printerUrl: validation.data.printerUrl,
        apiKey: validation.data.apiKey || null,
        locationId: validation.data.locationId || null,
        templateId: validation.data.templateId || null
      });

      if (result.error)
        return { success: false, message: result.error.message };

      await invalidatePrinterCache(companyId);

      return {
        success: true,
        message: validation.data.id
          ? "Printer route updated"
          : "Printer route created"
      };
    }

    case "testPrint": {
      const routeId = formData.get("routeId") as string;
      if (!routeId) return { success: false, message: "Route ID required" };

      const { data: route } = await client
        .from("printerRoute")
        .select("printerUrl, format, mediaSizeId, apiKey")
        .eq("id", routeId)
        .eq("companyId", companyId)
        .single();

      if (!route) return { success: false, message: "Printer route not found" };

      try {
        const headers: Record<string, string> = {
          "Content-Type": "application/octet-stream"
        };
        if (route.apiKey) headers["X-API-Key"] = route.apiKey;

        const testLabel = generateTestLabel(route.format, route.mediaSizeId);

        if (!testLabel) {
          return {
            success: false,
            message:
              "Test print is only supported for ZPL label printers with a media size configured."
          };
        }

        const response = await fetch(route.printerUrl, {
          method: "POST",
          headers,
          body: testLabel,
          signal: AbortSignal.timeout(10_000)
        });

        if (!response.ok) {
          return {
            success: false,
            message: `Print failed (${response.status} ${response.statusText})`
          };
        }

        return { success: true, message: "Test label sent to printer" };
      } catch (err) {
        return {
          success: false,
          message: `Print failed: ${err instanceof Error ? err.message : "Unknown error"}`
        };
      }
    }

    case "updateAssignment": {
      const validation = await validator(updateAssignmentValidator).validate(
        formData
      );

      if (validation.error) {
        return { success: false, message: "Invalid form data" };
      }

      const { locationId, context, contextId, printerRouteId, autoPrint } =
        validation.data;

      const { data: existing } = await getPrintingSettings(client, companyId);
      const current = (existing?.printing as PrintingSettings | null) ?? {
        assignments: {}
      };

      const updated = setContextAssignment(
        current,
        locationId,
        context,
        { printerRouteId: printerRouteId || null, autoPrint },
        contextId
      );

      const result = await updatePrintingSettings(client, companyId, updated);

      if (result.error)
        return { success: false, message: result.error.message };

      await invalidatePrinterCache(companyId);

      return { success: true, message: "Assignment updated" };
    }
  }

  return { success: false, message: "Unknown intent" };
}

export default function PrintingSettingsRoute() {
  const { printing, printerRoutes, workCenters, locations } =
    useLoaderData<typeof loader>();

  return (
    <ScrollArea className="w-full h-[calc(100dvh-49px)]">
      <VStack
        spacing={4}
        className="py-12 px-4 max-w-[60rem] h-full mx-auto gap-4"
      >
        <div className="flex items-center justify-between w-full">
          <Heading size="h3">
            <Trans>Printing</Trans>
          </Heading>
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
      </VStack>
      <Outlet />
    </ScrollArea>
  );
}
