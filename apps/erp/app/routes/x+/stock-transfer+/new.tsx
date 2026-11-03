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
import { Trans } from "@lingui/react/macro";
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
import { path } from "~/utils/path";

const logger = getLogger("erp", "stock-transfer-new");

export const handle: Handle = {
  breadcrumb: msg`Stock Transfers`,
  to: path.to.stockTransfers
};

// Everything the page shows comes from here, in one round trip: the stock at
// the location and its storage units. The line pickers read both, so adding
// lines makes no further requests.
export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "inventory"
  });

  let locationId = new URL(request.url).searchParams.get("location");
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

  const [stock, storageUnits] = await Promise.all([
    client.rpc("get_item_storage_unit_requirements_by_location", {
      company_id: companyId,
      location_id: locationId
    }),
    getStorageUnitsTreeForLocation(client, companyId, locationId)
  ]);
  if (stock.error || storageUnits.error) {
    logger.error("Failed to load stock for a new stock transfer", {
      companyId,
      locationId,
      error: stock.error ?? storageUnits.error
    });
    throw redirect(
      path.to.stockTransfers,
      await flash(
        request,
        error(stock.error ?? storageUnits.error, "Failed to load stock")
      )
    );
  }

  return {
    locationId,
    rows: stock.data ?? [],
    storageUnits: storageUnits.data ?? []
  };
}

// The lines, `acknowledged` once the user accepts the rule violations shown
// to them, and `stay` when the caller (the quick Move modal) stays on its own
// page instead of opening the new transfer.
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
  // Created, but its lines did not all move: open it, where they can be
  // picked, rather than leave the lines on the page to be sent twice.
  if (result.data.moveError) {
    throw redirect(
      path.to.stockTransfer(result.data.id),
      await flash(
        args.request,
        error(
          result.data.moveError,
          `${result.data.stockTransferId} was created, but not every line moved: ${result.data.moveError}`
        )
      )
    );
  }
  if (stay) return result;
  throw redirect(path.to.stockTransfer(result.data.id));
}

export default function NewStockTransferRoute() {
  const { locationId, rows, storageUnits } = useLoaderData<typeof loader>();
  const locations = useLocations();
  const navigate = useNavigate();

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
        storageUnits={storageUnits}
      />
    </NewRecordPage>
  );
}
