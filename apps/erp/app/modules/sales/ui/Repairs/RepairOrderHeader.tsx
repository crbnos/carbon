import {
  Button,
  Card,
  CardAttribute,
  CardAttributeLabel,
  CardAttributes,
  CardAttributeValue,
  CardContent,
  CardHeader,
  CardTitle,
  HStack,
  Menubar,
  useDisclosure
} from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  LuCheck,
  LuCirclePlus,
  LuFileText,
  LuHandCoins,
  LuTruck,
  LuUndo2,
  LuX
} from "react-icons/lu";
import { Link, useFetcher, useSubmit } from "react-router";
import { ConfirmDelete } from "~/components/Modals";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import { RepairOrderStatus } from "./RepairOrderStatus";
import type { RepairOrderLine } from "./types";

type RepairOrderHeaderProps = {
  repairOrder: {
    id: string;
    repairOrderId: string;
    status: string;
    customerId: string;
    customerReference: string | null;
    supplierId: string | null;
    supplierReference: string | null;
    orderDate: string;
    promisedDate: string | null;
    salesReturnOrderId: string | null;
    quoteId: string | null;
    salesOrderId: string | null;
    purchaseOrderId: string | null;
  };
  lines: RepairOrderLine[];
};

const RepairOrderHeader = ({ repairOrder, lines }: RepairOrderHeaderProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const submit = useSubmit();
  const fetcher = useFetcher();
  const cancelDisclosure = useDisclosure();

  const id = repairOrder.id;
  const canUpdate = permissions.can("update", "sales");
  const isOpen = !["Completed", "Cancelled"].includes(repairOrder.status);

  // Each leg is only offered when a unit is actually in the state it moves
  // from — the posting refuses anything else, so the button follows custody.
  const hasPending = lines.some((line) => line.status === "Pending");
  const hasInShop = lines.some((line) => line.status === "Received");
  const hasAtSupplier = lines.some((line) => line.status === "At Supplier");
  const hasRepaired = lines.some((line) => line.status === "Repaired");

  const receive = (leg: "intake" | "return") => {
    const formData = new FormData();
    formData.set("sourceDocument", "Repair Order");
    formData.set("sourceDocumentId", id);
    formData.set("leg", leg);
    submit(formData, { method: "post", action: path.to.newReceipt });
  };

  const ship = (leg: "supplier" | "customer") => {
    const formData = new FormData();
    formData.set("sourceDocument", "Repair Order");
    formData.set("sourceDocumentId", id);
    formData.set("leg", leg);
    submit(formData, { method: "post", action: path.to.newShipment });
  };

  const post = (action: string) =>
    fetcher.submit({}, { method: "post", action });

  return (
    <>
      <div className="flex flex-col gap-2 p-2 border-b bg-background">
        <HStack className="w-full justify-between">
          <HStack spacing={2}>
            <h1 className="text-lg font-semibold">
              {repairOrder.repairOrderId}
            </h1>
            <RepairOrderStatus status={repairOrder.status} />
          </HStack>

          <Menubar>
            {repairOrder.status === "Draft" && (
              <Button
                leftIcon={<LuCheck />}
                isDisabled={!canUpdate}
                onClick={() => post(path.to.repairOrderConfirm(id))}
              >
                <Trans>Confirm</Trans>
              </Button>
            )}
            {isOpen && hasPending && (
              <Button
                variant="secondary"
                leftIcon={<LuUndo2 />}
                isDisabled={!canUpdate}
                onClick={() => receive("intake")}
              >
                <Trans>Receive from Customer</Trans>
              </Button>
            )}
            {isOpen && hasInShop && (
              <Button
                variant="secondary"
                leftIcon={<LuTruck />}
                isDisabled={!canUpdate || !repairOrder.supplierId}
                onClick={() => ship("supplier")}
              >
                <Trans>Ship to Supplier</Trans>
              </Button>
            )}
            {isOpen && hasAtSupplier && (
              <Button
                variant="secondary"
                leftIcon={<LuUndo2 />}
                isDisabled={!canUpdate}
                onClick={() => receive("return")}
              >
                <Trans>Receive from Supplier</Trans>
              </Button>
            )}
            {isOpen && hasRepaired && (
              <Button
                variant="secondary"
                leftIcon={<LuTruck />}
                isDisabled={!canUpdate}
                onClick={() => ship("customer")}
              >
                <Trans>Ship to Customer</Trans>
              </Button>
            )}
            {isOpen && (
              <>
                <Button
                  variant="secondary"
                  leftIcon={<LuFileText />}
                  isDisabled={!canUpdate}
                  onClick={() => post(path.to.repairOrderQuote(id))}
                >
                  <Trans>Create Quote</Trans>
                </Button>
                <Button
                  variant="secondary"
                  leftIcon={<LuHandCoins />}
                  isDisabled={!canUpdate}
                  onClick={() => post(path.to.repairOrderSalesOrder(id))}
                >
                  <Trans>Create Sales Order</Trans>
                </Button>
                {repairOrder.supplierId && (
                  <Button
                    variant="secondary"
                    leftIcon={<LuCirclePlus />}
                    isDisabled={!permissions.can("create", "purchasing")}
                    onClick={() => post(path.to.repairOrderPurchaseOrder(id))}
                  >
                    <Trans>Create Repair PO</Trans>
                  </Button>
                )}
                <Button
                  variant="secondary"
                  leftIcon={<LuCheck />}
                  isDisabled={!canUpdate}
                  onClick={() => post(path.to.repairOrderComplete(id))}
                >
                  <Trans>Complete</Trans>
                </Button>
                <Button
                  variant="destructive"
                  leftIcon={<LuX />}
                  isDisabled={!canUpdate}
                  onClick={cancelDisclosure.onOpen}
                >
                  <Trans>Cancel</Trans>
                </Button>
              </>
            )}
          </Menubar>
        </HStack>
      </div>

      <Card className="m-2">
        <CardHeader>
          <CardTitle>
            <Trans>Repair Order</Trans>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <CardAttributes>
            <CardAttribute>
              <CardAttributeLabel>
                <Trans>Customer Reference</Trans>
              </CardAttributeLabel>
              <CardAttributeValue>
                {repairOrder.customerReference ?? "—"}
              </CardAttributeValue>
            </CardAttribute>
            <CardAttribute>
              <CardAttributeLabel>
                <Trans>Supplier RMA Number</Trans>
              </CardAttributeLabel>
              <CardAttributeValue>
                {repairOrder.supplierReference ?? "—"}
              </CardAttributeValue>
            </CardAttribute>
            <CardAttribute>
              <CardAttributeLabel>
                <Trans>Opened</Trans>
              </CardAttributeLabel>
              <CardAttributeValue>
                {formatDate(repairOrder.orderDate)}
              </CardAttributeValue>
            </CardAttribute>
            <CardAttribute>
              <CardAttributeLabel>
                <Trans>Promised</Trans>
              </CardAttributeLabel>
              <CardAttributeValue>
                {repairOrder.promisedDate
                  ? formatDate(repairOrder.promisedDate)
                  : "—"}
              </CardAttributeValue>
            </CardAttribute>
            {repairOrder.salesReturnOrderId && (
              <CardAttribute>
                <CardAttributeLabel>
                  <Trans>From RMA</Trans>
                </CardAttributeLabel>
                <CardAttributeValue>
                  <Link
                    to={path.to.salesReturnOrderDetails(
                      repairOrder.salesReturnOrderId
                    )}
                  >
                    <Trans>Open return</Trans>
                  </Link>
                </CardAttributeValue>
              </CardAttribute>
            )}
            {repairOrder.quoteId && (
              <CardAttribute>
                <CardAttributeLabel>
                  <Trans>Quote</Trans>
                </CardAttributeLabel>
                <CardAttributeValue>
                  <Link to={path.to.quoteDetails(repairOrder.quoteId)}>
                    <Trans>Open quote</Trans>
                  </Link>
                </CardAttributeValue>
              </CardAttribute>
            )}
            {repairOrder.salesOrderId && (
              <CardAttribute>
                <CardAttributeLabel>
                  <Trans>Sales Order</Trans>
                </CardAttributeLabel>
                <CardAttributeValue>
                  <Link
                    to={path.to.salesOrderDetails(repairOrder.salesOrderId)}
                  >
                    <Trans>Open order</Trans>
                  </Link>
                </CardAttributeValue>
              </CardAttribute>
            )}
            {repairOrder.purchaseOrderId && (
              <CardAttribute>
                <CardAttributeLabel>
                  <Trans>Repair PO</Trans>
                </CardAttributeLabel>
                <CardAttributeValue>
                  <Link
                    to={path.to.purchaseOrderDetails(
                      repairOrder.purchaseOrderId
                    )}
                  >
                    <Trans>Open PO</Trans>
                  </Link>
                </CardAttributeValue>
              </CardAttribute>
            )}
          </CardAttributes>
        </CardContent>
      </Card>

      {cancelDisclosure.isOpen && (
        <ConfirmDelete
          action={path.to.repairOrderCancel(id)}
          isOpen
          name={repairOrder.repairOrderId}
          text={t`Are you sure you want to cancel this repair order? This is only possible while nothing has been received.`}
          onCancel={cancelDisclosure.onClose}
          onSubmit={cancelDisclosure.onClose}
        />
      )}
    </>
  );
};

export default RepairOrderHeader;
