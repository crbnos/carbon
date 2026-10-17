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
import { Customer, Submit } from "~/components/Form";
import { usePermissions } from "~/hooks";
import { getFixedAsset } from "~/modules/accounting/accounting.service";
import { path } from "~/utils/path";

const sellAssetValidator = z.object({
  customerId: z.string().min(1, { message: "Customer is required" })
});

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

  if (!["Active", "Fully Depreciated"].includes(asset.data.status)) {
    throw redirect(
      path.to.fixedAsset(fixedAssetId),
      await flash(request, error(null, "Only active assets can be sold"))
    );
  }

  return null;
}

export async function action(args: ActionFunctionArgs) {
  const input = await validator(sellAssetValidator).request(args, {
    params: ["fixedAssetId"]
  });
  if ("invalid" in input) return input.invalid;
  const { fixedAssetId } = input.params;
  const api = await carbon(args.request);
  const result = await api.accounting.sellFixedAsset({
    fixedAssetId,
    customerId: input.data.customerId
  });
  return respond(args.request, result).redirect(
    result.data
      ? path.to.salesOrder(result.data.salesOrderId)
      : path.to.fixedAsset(fixedAssetId),
    { message: "Sales order created" }
  );
}

export default function SellFixedAssetRoute() {
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
        <ValidatedForm validator={sellAssetValidator} method="post">
          <ModalHeader>
            <ModalTitle>Sell Asset</ModalTitle>
          </ModalHeader>
          <ModalBody>
            <VStack spacing={4}>
              <Customer name="customerId" label="Customer" />
            </VStack>
          </ModalBody>
          <ModalFooter>
            <HStack>
              <Submit isDisabled={!permissions.can("create", "sales")}>
                Create Sales Order
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
