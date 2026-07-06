import { error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { PrintingSettings } from "@carbon/printing";
import { deletePrinterRoute } from "@carbon/printing";
import { invalidatePrinterCache } from "@carbon/printing/printing.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    update: "settings"
  });

  const { id } = params;
  if (!id) throw new Error("Printer route ID is required");

  const result = await deletePrinterRoute(client, id, companyId);
  if (result.error) {
    throw redirect(
      path.to.printingSettings,
      await flash(
        request,
        error(result.error, "Failed to delete printer route")
      )
    );
  }

  // Clean up dangling references in printing settings
  const { data: existing } = await client
    .from("companySettings")
    .select("printing")
    .eq("id", companyId)
    .single();

  const current = existing?.printing as PrintingSettings | null;
  if (current) {
    let dirty = false;
    const settings = { ...current };

    if (settings.assignments) {
      const assignments = { ...settings.assignments };
      for (const [locId, location] of Object.entries(assignments)) {
        if (!location) continue;
        const loc = { ...location };

        if (loc.defaultPrinterRouteId === id) {
          loc.defaultPrinterRouteId = null;
          dirty = true;
        }

        if (loc.shipping?.printerRouteId === id) {
          loc.shipping = { ...loc.shipping, printerRouteId: null };
          dirty = true;
        }

        if (loc.receiving?.printerRouteId === id) {
          loc.receiving = { ...loc.receiving, printerRouteId: null };
          dirty = true;
        }

        if (loc.workCenters) {
          const workCenters = { ...loc.workCenters };
          for (const [wcId, wc] of Object.entries(workCenters)) {
            if (wc?.printerRouteId === id) {
              workCenters[wcId] = { ...wc, printerRouteId: null };
              dirty = true;
            }
          }
          loc.workCenters = workCenters;
        }

        assignments[locId] = loc;
      }
      settings.assignments = assignments;
    }

    if (dirty) {
      await client
        .from("companySettings")
        .update({ printing: JSON.parse(JSON.stringify(settings)) })
        .eq("id", companyId);
    }
  }

  await invalidatePrinterCache(companyId);

  throw redirect(
    path.to.printingSettings,
    await flash(request, success("Printer route deleted"))
  );
}
