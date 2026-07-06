import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { ValidatedForm, validationError, validator } from "@carbon/form";
import {
  Button,
  HStack,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  VStack
} from "@carbon/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useNavigate } from "react-router";
import { z } from "zod";
import { Customer, Submit } from "~/components/Form";
import { usePermissions } from "~/hooks";
import { getFixedAsset } from "~/modules/accounting";
import { insertSalesOrder } from "~/modules/sales";
import { getUserDefaults } from "~/modules/users/users.server";
import { path } from "~/utils/path";

const sellAssetValidator = z.object({
  customerId: z.string().min(1, { message: "Customer is required" })
});

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "accounting"
  });

  const { fixedAssetId } = params;
  if (!fixedAssetId) throw notFound("fixedAssetId not found");

  const asset = await getFixedAsset(client, fixedAssetId);
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

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, companyGroupId, userId } =
    await requirePermissions(request, {
      create: "sales"
    });

  const { fixedAssetId } = params;
  if (!fixedAssetId) throw notFound("fixedAssetId not found");

  const formData = await request.formData();
  const validation = await validator(sellAssetValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { customerId } = validation.data;

  const [asset, defaults] = await Promise.all([
    getFixedAsset(client, fixedAssetId),
    getUserDefaults(client, userId, companyId)
  ]);

  if (asset.error || !asset.data) {
    throw redirect(
      path.to.fixedAssets,
      await flash(request, error(asset.error, "Failed to get fixed asset"))
    );
  }

  const locationId = asset.data.locationId ?? defaults.data?.locationId ?? "";

  const newSO = await insertSalesOrder(client, {
    customerId,
    locationId: locationId ?? "",
    status: "Draft",
    companyId,
    companyGroupId,
    createdBy: userId
  });

  if (newSO.error || !newSO.data) {
    throw redirect(
      path.to.fixedAsset(fixedAssetId),
      await flash(request, error(newSO.error, "Failed to create sales order"))
    );
  }

  const salesOrderId = newSO.data.id;

  const nbv =
    Number(asset.data.acquisitionCost) -
    Number(asset.data.accumulatedDepreciation);

  await client.from("salesOrderLine").insert({
    salesOrderId,
    salesOrderLineType: "Fixed Asset",
    assetId: fixedAssetId,
    description: asset.data.name,
    saleQuantity: 1,
    unitPrice: nbv,
    locationId: asset.data.locationId ?? "",
    taxPercent: 0,
    exchangeRate: 1,
    companyId,
    createdBy: userId
  });

  throw redirect(
    path.to.salesOrder(salesOrderId),
    await flash(request, success("Sales order created"))
  );
}

export default function SellFixedAssetRoute() {
  const navigate = useNavigate();
  const permissions = usePermissions();

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) navigate(-1);
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
              <Button size="md" variant="solid" onClick={() => navigate(-1)}>
                Cancel
              </Button>
            </HStack>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
}
