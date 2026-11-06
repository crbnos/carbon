// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import { Combobox, Heading, HStack } from "@carbon/react";
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate } from "react-router";
import { zfd } from "zod-form-data";
import { useLocations } from "~/components/Form/Location";
import { NewRecordPage } from "~/components/NewRecordPage";
import { stockTransferValidator } from "~/modules/inventory/inventory.models";
import { getStorageUnitsTreeForLocation } from "~/modules/inventory/inventory.service";
import { StockTransferBuilder } from "~/modules/inventory/ui/StockTransfers/StockTransferBuilder";
import { getLocationsList } from "~/modules/resources/resources.service";
import { getUserDefaults } from "~/modules/users/users.service";
import { clearStockTransferWizard } from "~/stores";
import { setCustomFields } from "~/utils/form";
import type { Handle } from "~/utils/handle";
import { newRecordMeta } from "~/utils/meta";
import { path } from "~/utils/path";

const logger = getLogger("erp", "stock-transfer-new");

export const meta = newRecordMeta("Stock Transfer");

export const handle: Handle = {
  breadcrumb: msg`Stock Transfers`,
  to: path.to.stockTransfers
};

// Loads everything the page needs in one round trip, so the line pickers
// never fetch.
export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "inventory"
  });

  // A location named in the URL is used only when it is the company's.
  const requested = new URL(request.url).searchParams.get("location");
  let locationId: string | null = null;
  if (requested) {
    const location = await client
      .from("location")
      .select("id")
      .eq("id", requested)
      .eq("companyId", companyId)
      .maybeSingle();
    if (location.error) {
      logger.error("Failed to load the location for a new stock transfer", {
        companyId,
        locationId: requested,
        error: location.error
      });
      throw redirect(
        path.to.stockTransfers,
        await flash(
          request,
          error(location.error, "Failed to load the location")
        )
      );
    }
    locationId = location.data?.id ?? null;
  }
  if (!locationId) {
    const defaults = await getUserDefaults(client, userId, companyId);
    locationId = defaults.data?.locationId ?? null;
  }
  if (!locationId) {
    const locations = await getLocationsList(client, companyId);
    locationId = locations.data?.[0]?.id ?? null;
  }
  if (!locationId) {
    logger.error("No location for a new stock transfer", { companyId });
    throw redirect(
      path.to.stockTransfers,
      await flash(request, error(null, "Add a location first"))
    );
  }

  const api = await carbon(request);
  const [stock, storageUnits, trackedStock] = await Promise.all([
    client.rpc("get_item_storage_unit_requirements_by_location", {
      company_id: companyId,
      location_id: locationId
    }),
    getStorageUnitsTreeForLocation(client, companyId, locationId),
    api.inventory.getTrackedStockAtLocation({ locationId })
  ]);
  const failure = stock.error ?? storageUnits.error ?? trackedStock.error;
  if (failure || !trackedStock.data) {
    logger.error("Failed to load stock for a new stock transfer", {
      companyId,
      locationId,
      error: failure
    });
    throw redirect(
      path.to.stockTransfers,
      await flash(request, error(failure, "Failed to load stock"))
    );
  }

  return {
    locationId,
    rows: stock.data ?? [],
    storageUnits: storageUnits.data ?? [],
    trackedStock: trackedStock.data
  };
}

// `stay` keeps the caller (the Move modal) on its own page instead of
// opening the new transfer.
const createForm = stockTransferValidator.extend({
  acknowledged: zfd.checkbox({ trueValue: "true" }),
  stay: zfd.checkbox({ trueValue: "true" })
});

export async function action(args: ActionFunctionArgs) {
  const input = await validator(createForm).request(args);
  if ("invalid" in input) return input.invalid;
  const { locationId, lines, acknowledged, moveNow, stay } = input.data;
  const api = await carbon(args.request);
  const result = await api.inventory.createStockTransfer({
    locationId,
    lines,
    acknowledged,
    moveNow,
    customFields: input.formData && setCustomFields(input.formData)
  });
  // An error is toasted and the page keeps its lines.
  if (!result.data) return result;
  // A blocking rule: the violation modal reads these.
  if ("violations" in result.data) return result.data;
  // The caller stays on its own page, and shows a failed move there.
  if (stay) return result;
  // Created but not fully moved: open it rather than leave lines on the page
  // that could be sent twice.
  if (result.data.moveError) {
    throw redirect(
      path.to.stockTransfer(result.data.id),
      await flash(
        args.request,
        error(
          null,
          `${result.data.stockTransferId} was created, but not every line moved: ${result.data.moveError}`
        )
      )
    );
  }
  throw redirect(path.to.stockTransfer(result.data.id));
}

export default function NewStockTransferRoute() {
  const { locationId, rows, storageUnits, trackedStock } =
    useLoaderData<typeof loader>();
  const locations = useLocations();
  const navigate = useNavigate();
  const { t } = useLingui();

  // Lines belong to one location: start empty, and again on a switch.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs per location on purpose
  useEffect(() => {
    clearStockTransferWizard();
  }, [locationId]);

  return (
    <NewRecordPage className="flex max-w-none flex-col p-0 sm:p-0 md:mt-0 max-md:px-0 max-md:pt-0 h-[calc(100dvh-var(--topbar-height)-var(--content-inset))]">
      <HStack className="w-full flex-shrink-0 justify-between gap-2 px-4 py-3">
        <Heading as="h1" size="h3" className="font-sans">
          <Trans>New Stock Transfer</Trans>
        </Heading>
        <div className="shrink-0">
          <Combobox
            asButton
            aria-label={t`Location`}
            size="sm"
            value={locationId}
            options={locations}
            onChange={(selected) => {
              if (selected && selected !== locationId) {
                navigate(`${path.to.newStockTransfer}?location=${selected}`);
              }
            }}
          />
        </div>
      </HStack>
      <StockTransferBuilder
        key={locationId}
        locationId={locationId}
        rows={rows}
        trackedStock={trackedStock}
        storageUnits={storageUnits}
      />
    </NewRecordPage>
  );
}
