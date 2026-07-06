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
import { Submit, Supplier } from "~/components/Form";
import { usePermissions } from "~/hooks";
import { getFixedAsset } from "~/modules/accounting";
import {
  insertPurchaseOrder,
  upsertPurchaseOrderLine
} from "~/modules/purchasing";
import { getUserDefaults } from "~/modules/users/users.server";
import { path } from "~/utils/path";

const purchaseAssetValidator = z.object({
  supplierId: z.string().min(1, { message: "Supplier is required" })
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

  if (asset.data.status !== "Draft") {
    throw redirect(
      path.to.fixedAsset(fixedAssetId),
      await flash(request, error(null, "Only Draft assets can be purchased"))
    );
  }

  return null;
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, companyGroupId, userId } =
    await requirePermissions(request, {
      create: "purchasing"
    });

  const { fixedAssetId } = params;
  if (!fixedAssetId) throw notFound("fixedAssetId not found");

  const formData = await request.formData();
  const validation = await validator(purchaseAssetValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { supplierId } = validation.data;

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

  const newPO = await insertPurchaseOrder(client, {
    supplierId,
    locationId,
    status: "Draft",
    purchaseOrderType: "Purchase",
    companyId,
    companyGroupId,
    createdBy: userId
  });

  if (newPO.error || !newPO.data) {
    throw redirect(
      path.to.fixedAsset(fixedAssetId),
      await flash(
        request,
        error(newPO.error, "Failed to create purchase order")
      )
    );
  }

  const purchaseOrderId = newPO.data.id;

  await upsertPurchaseOrderLine(client, {
    purchaseOrderId,
    purchaseOrderLineType: "Fixed Asset",
    assetId: fixedAssetId,
    description: asset.data.name,
    locationId,
    purchaseQuantity: 1,
    supplierUnitPrice: 0,
    supplierShippingCost: 0,
    supplierTaxAmount: 0,
    exchangeRate: 1,
    purchaseUnitOfMeasureCode: "EA",
    inventoryUnitOfMeasureCode: "EA",
    conversionFactor: 1,
    companyId,
    createdBy: userId
  });

  throw redirect(
    path.to.purchaseOrder(purchaseOrderId),
    await flash(request, success("Purchase order created"))
  );
}

export default function PurchaseFixedAssetRoute() {
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
