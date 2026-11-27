// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { cachedApiQuery, type LoaderData } from "@carbon/query";
import {
  Button,
  Table as TableBase,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  toast,
  toastError,
  useDisclosure
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { Dispatch, SetStateAction } from "react";
import { useCallback } from "react";
import { LuCircleCheck, LuCirclePlus } from "react-icons/lu";
import { SupplierAvatar } from "~/components";
import { useUnitOfMeasure } from "~/components/Form/UnitOfMeasure";
import type { SupplierPart } from "~/modules/items/types";
import { SupplierPartForm } from "~/modules/items/ui/Item";
import { SupplierPartPrice } from "~/modules/items/ui/Item/SupplierParts";
import type { loader as supplierPartsLoader } from "~/routes/api+/purchasing.planning-supplier-parts";
import { path } from "~/utils/path";
import type { PlannedOrder } from "../../purchasing.models";
import type { PurchasingPlanningItem } from "../../types";

type DrawerSuppliersTabProps = {
  item: PurchasingPlanningItem;
  setItem: Dispatch<SetStateAction<PurchasingPlanningItem | null>>;
  selectedSupplier: string;
  onSupplierChange: (itemId: string, supplierId: string) => void;
  /** The drawer's draft orders, which take the chosen supplier. */
  orders: PlannedOrder[];
  setOrders: (item: PurchasingPlanningItem, orders: PlannedOrder[]) => void;
  /** A supplier was chosen: the drawer goes back to its orders. */
  onSupplierChosen: () => void;
};

/**
 * The purchasing order drawer's Suppliers tab: the item's supplier parts as
 * the drawer opened on them, a Select for the supplier its orders go to, and
 * Add Supplier.
 */
export function DrawerSuppliersTab({
  item,
  setItem,
  selectedSupplier,
  onSupplierChange,
  orders,
  setOrders,
  onSupplierChosen
}: DrawerSuppliersTabProps) {
  const { t } = useLingui();
  const unitOfMeasureOptions = useUnitOfMeasure();
  const supplierDisclosure = useDisclosure();

  // The supplier the drawer's orders go to, and each draft order with it.
  const chooseSupplier = useCallback(
    (supplierId: string, message: string) => {
      if (!item.id) return;
      onSupplierChange(item.id, supplierId);
      setOrders(
        item,
        orders.map((order) => ({ ...order, supplierId }))
      );
      toast.success(message);
      onSupplierChosen();
    },
    [item, onSupplierChange, setOrders, orders, onSupplierChosen]
  );

  // A supplier part was added: the drawer's row is the grid's row as it was
  // when opened, so read the item's suppliers again. The first supplier of
  // an item is also chosen for its orders.
  const onSupplierPartSaved = useCallback(async () => {
    const itemId = item.id;
    if (!itemId) return;
    let suppliers: SupplierPart[];
    try {
      ({ suppliers } = await cachedApiQuery<
        LoaderData<typeof supplierPartsLoader>
      >(path.to.api.planningSupplierParts(itemId), { staleTime: 0 }));
    } catch (error) {
      toastError(t`Failed to load the suppliers`, error);
      return;
    }
    setItem((prev) => (prev?.id === itemId ? { ...prev, suppliers } : prev));
    if (suppliers.length !== 1) return;
    chooseSupplier(suppliers[0].supplierId, t`Supplier added and selected`);
  }, [item.id, setItem, chooseSupplier, t]);

  return (
    <>
      <TableBase>
        <Thead>
          <Tr>
            <Th>
              <Trans>Supplier</Trans>
            </Th>
            <Th>
              <Trans>Unit</Trans>
            </Th>
            <Th>
              <Trans>Conversion</Trans>
            </Th>
            <Th>
              <Trans>Unit Price</Trans>
            </Th>
            <Th />
          </Tr>
        </Thead>
        <Tbody>
          {(item.suppliers as SupplierPart[])?.map((part) => (
            <Tr key={part.id}>
              <Td>
                <SupplierAvatar supplierId={part.supplierId} />
              </Td>
              <Td>
                {
                  unitOfMeasureOptions.find(
                    (uom) => uom.value === part.supplierUnitOfMeasureCode
                  )?.label
                }
              </Td>
              <Td>{part.conversionFactor}</Td>
              <Td>
                <SupplierPartPrice
                  price={part.supplierUnitPrice}
                  currencyCode={part.currencyCode}
                />
              </Td>
              <Td className="text-end">
                <Button
                  variant="secondary"
                  isDisabled={selectedSupplier === part.supplierId}
                  leftIcon={<LuCircleCheck />}
                  onClick={() =>
                    chooseSupplier(part.supplierId, t`Supplier updated`)
                  }
                >
                  <Trans>Select</Trans>
                </Button>
              </Td>
            </Tr>
          ))}
        </Tbody>
      </TableBase>
      <div>
        <Button
          variant="secondary"
          leftIcon={<LuCirclePlus />}
          onClick={supplierDisclosure.onOpen}
        >
          <Trans>Add Supplier</Trans>
        </Button>
        {supplierDisclosure.openCount > 0 && (
          <SupplierPartForm
            key={`supplierDisclosure-${supplierDisclosure.openCount}`}
            open={supplierDisclosure.isOpen}
            type="Part"
            initialValues={{
              itemId: item.id,
              supplierId: "",
              supplierPartId: "",
              supplierUnitPrice: 0,
              supplierUnitOfMeasureCode: "EA",
              minimumOrderQuantity: 1,
              orderMultiple: 1,
              conversionFactor: 1
            }}
            unitOfMeasureCode={item.unitOfMeasureCode ?? ""}
            onSaved={onSupplierPartSaved}
            onClose={supplierDisclosure.onClose}
          />
        )}
      </div>
    </>
  );
}
