// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { error, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { ValidatedForm, validator } from "@carbon/form";
import {
  Button,
  HStack,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  useCloseRoute,
  VStack
} from "@carbon/react";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { z } from "zod";
import { Submit, Supplier } from "~/components/Form";
import { usePermissions } from "~/hooks";
import { getFixedAsset } from "~/modules/accounting/accounting.service";
import { path } from "~/utils/path";

const purchaseAssetValidator = z.object({
  supplierId: z.string().min(1, { message: "Supplier is required" })
});

// A construction-in-progress asset collects purchased cost alongside job
// cost, so it can still be purchased while Under Construction; receipt and
// invoice posting add a CIP cost row and leave its status alone.
const PURCHASABLE_ASSET_STATUSES: string[] = ["Draft", "Under Construction"];

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "accounting"
  });

  const { fixedAssetId } = params;
  if (!fixedAssetId) throw notFound("fixedAssetId not found");

  const asset = await getFixedAsset(client, fixedAssetId, companyId);
  if (asset.error) {
    throw redirect(
      path.to.fixedAssets,
      await flash(request, error(asset.error, "Failed to get fixed asset"))
    );
  }

  if (!PURCHASABLE_ASSET_STATUSES.includes(asset.data.status)) {
    throw redirect(
      path.to.fixedAsset(fixedAssetId),
      await flash(
        request,
        error(null, "Only a Draft or Under Construction asset can be purchased")
      )
    );
  }

  return null;
}

export async function action(args: ActionFunctionArgs) {
  const input = await validator(purchaseAssetValidator).request(args, {
    params: ["fixedAssetId"]
  });
  if ("invalid" in input) return input.invalid;
  const { fixedAssetId } = input.params;
  const api = await carbon(args.request);
  const result = await api.accounting.purchaseFixedAsset({
    fixedAssetId,
    supplierId: input.data.supplierId
  });
  return respond(args.request, result).redirect(
    result.data
      ? path.to.purchaseOrder(result.data.purchaseOrderId)
      : path.to.fixedAsset(fixedAssetId),
    { message: "Purchase order created" }
  );
}

export default function PurchaseFixedAssetRoute() {
  const closeRoute = useCloseRoute();
  const permissions = usePermissions();

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) closeRoute();
      }}
    >
      <ModalContent>
        <ValidatedForm validator={purchaseAssetValidator} method="post">
          <ModalHeader>
            <ModalTitle>Purchase Asset</ModalTitle>
          </ModalHeader>
          <ModalBody>
            <VStack spacing={4}>
              <Supplier name="supplierId" label="Supplier" />
            </VStack>
          </ModalBody>
          <ModalFooter>
            <HStack>
              <Submit isDisabled={!permissions.can("create", "purchasing")}>
                Create Purchase Order
              </Submit>
              <Button size="md" variant="solid" onClick={() => closeRoute()}>
                Cancel
              </Button>
            </HStack>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
}
