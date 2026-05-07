import { useCarbon } from "@carbon/auth";
import { InputControlled, ValidatedForm } from "@carbon/form";
import {
  Button,
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  Copy,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Heading,
  HStack,
  IconButton,
  toast,
  useDisclosure,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useCallback, useEffect, useState } from "react";
import {
  LuCheckCheck,
  LuChevronDown,
  LuCirclePlus,
  LuCircleStop,
  LuEllipsisVertical,
  LuHandCoins,
  LuLoaderCircle,
  LuTrash,
  LuTruck
} from "react-icons/lu";
import { Link, useSubmit } from "react-router";
import type { z } from "zod";
import { useAuditLog } from "~/components/AuditLog";
import {
  DatePicker,
  Hidden,
  Input,
  Location,
  SequenceOrCustomId,
  Submit,
  TextArea
} from "~/components/Form";
import ConfirmDelete from "~/components/Modals/ConfirmDelete";
import { usePermissions, useUser } from "~/hooks";
import { useItemRuleViolations } from "~/hooks/useItemRuleViolations";
import type { action as statusAction } from "~/routes/x+/warehouse-transfer+/$transferId.status";
import { path } from "~/utils/path";
import {
  isWarehouseTransferLocked,
  warehouseTransferValidator
} from "../../inventory.models";
import type { Receipt, Shipment, WarehouseTransfer } from "../../types";
import { ReceiptStatus } from "../Receipts";
import { ShipmentStatus } from "../Shipments";
import WarehouseTransferStatus from "./WarehouseTransferStatus";

type WarehouseTransferFormProps = {
  initialValues: z.infer<typeof warehouseTransferValidator>;
  warehouseTransfer?: WarehouseTransfer;
};

const WarehouseTransferForm = ({
  initialValues,
  warehouseTransfer
}: WarehouseTransferFormProps) => {
  const { company } = useUser();
  const permissions = usePermissions();
  // Item rules eval at every "go" status transition (Confirm/Ship/Receive/
  // Complete). Surface violations through the hook's modal rather than the
  // plain navigation path.
  const statusRules = useItemRuleViolations<typeof statusAction>({
    action: warehouseTransfer?.id
      ? path.to.warehouseTransferStatus(warehouseTransfer.id)
      : ""
  });
  const statusFetcher = statusRules.fetcher;
  const deleteModal = useDisclosure();
  const { trigger: auditLogTrigger, drawer: auditLogDrawer } = useAuditLog({
    entityType: "warehouseTransfer",
    entityId: warehouseTransfer?.id ?? "",
    companyId: company.id,
    variant: "dropdown"
  });

  const { t } = useLingui();
  const isEditing = !!initialValues.id;
  const isLocked = isWarehouseTransferLocked(warehouseTransfer?.status);
  const canEdit = isEditing
    ? permissions.can("update", "inventory") &&
      ["Draft"].includes(warehouseTransfer?.status ?? "")
    : permissions.can("create", "inventory");

  const { receipts, shipments, ship, receive, hasShippedItems } =
    useWarehouseTransferRelatedDocuments(warehouseTransfer?.id);

  return (
    <>
      <ValidatedForm
        validator={warehouseTransferValidator}
        method="post"
        defaultValues={initialValues}
        className="w-full"
        isDisabled={isEditing && isLocked}
      >
        <Card className="w-full">
          {isEditing && warehouseTransfer ? (
            <CardHeader className="flex-row items-center justify-between">
              <HStack>
                <Heading as="h1" size="h3">
                  {warehouseTransfer.transferId}
                </Heading>
                <Copy text={warehouseTransfer.transferId ?? ""} />
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <IconButton
                      aria-label={t`More options`}
                      icon={<LuEllipsisVertical />}
                      variant="secondary"
                      size="sm"
                    />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    {auditLogTrigger}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      disabled={
                        ["Draft"].includes(warehouseTransfer.status ?? "") ||
                        statusFetcher.state !== "idle" ||
                        !permissions.can("update", "inventory")
                      }
                      onClick={() => {
                        statusFetcher.submit(
                          { status: "Draft" },
                          {
                            method: "post",
                            action: path.to.warehouseTransferStatus(
                              warehouseTransfer.id
                            )
                          }
                        );
                      }}
                    >
                      <DropdownMenuIcon icon={<LuLoaderCircle />} />
                      <Trans>Reopen</Trans>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      disabled={
                        isLocked ||
                        !permissions.can("delete", "inventory") ||
                        !permissions.is("employee")
                      }
                      destructive
                      onClick={deleteModal.onOpen}
                    >
                      <DropdownMenuIcon icon={<LuTrash />} />
                      <Trans>Delete Warehouse Transfer</Trans>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <WarehouseTransferStatus status={warehouseTransfer.status} />
              </HStack>
              <HStack>
                <Button
                  type="button"
                  leftIcon={<LuCheckCheck />}
                  variant={
                    warehouseTransfer.status === "Draft"
                      ? "primary"
                      : "secondary"
                  }
                  isDisabled={
                    !["Draft"].includes(warehouseTransfer.status) ||
                    statusFetcher.state !== "idle" ||
                    !permissions.can("update", "inventory")
                  }
                  isLoading={
                    statusFetcher.state !== "idle" &&
                    statusFetcher.formData?.get("status") ===
                      "To Ship and Receive"
                  }
                  onClick={() => {
                    const fd = new FormData();
                    fd.set("status", "To Ship and Receive");
                    statusRules.submit(fd);
                  }}
                >
                  <Trans>Confirm</Trans>
                </Button>

                <Button
                  type="button"
                  variant="secondary"
                  leftIcon={<LuCircleStop />}
                  isDisabled={
                    ["Cancelled", "Completed"].includes(
                      warehouseTransfer.status
                    ) ||
                    statusFetcher.state !== "idle" ||
                    !permissions.can("update", "inventory")
                  }
                  isLoading={
                    statusFetcher.state !== "idle" &&
                    statusFetcher.formData?.get("status") === "Cancelled"
                  }
                  onClick={() => {
                    const fd = new FormData();
                    fd.set("status", "Cancelled");
                    statusRules.submit(fd);
                  }}
                >
                  <Trans>Cancel</Trans>
                </Button>

                {shipments.length > 0 ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        leftIcon={<LuTruck />}
                        variant="secondary"
                        rightIcon={<LuChevronDown />}
                      >
                        <Trans>Shipments</Trans>
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      <DropdownMenuItem
                        disabled={
                          !["To Ship", "To Ship and Receive"].includes(
                            warehouseTransfer.status ?? ""
                          )
                        }
                        onClick={() => ship(warehouseTransfer)}
                      >
                        <DropdownMenuIcon icon={<LuCirclePlus />} />
                        <Trans>New Shipment</Trans>
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      {shipments.map((shipment) => (
                        <DropdownMenuItem key={shipment.id} asChild>
                          <Link to={path.to.shipment(shipment.id)}>
                            <DropdownMenuIcon icon={<LuTruck />} />
                            <HStack spacing={8}>
                              <span>{shipment.shipmentId}</span>
                              <ShipmentStatus status={shipment.status} />
                            </HStack>
                          </Link>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : (
                  <Button
                    leftIcon={<LuTruck />}
                    isDisabled={
                      !["To Ship", "To Ship and Receive"].includes(
                        warehouseTransfer.status ?? ""
                      )
                    }
                    variant={
                      ["To Ship", "To Ship and Receive"].includes(
                        warehouseTransfer.status ?? ""
                      )
                        ? "primary"
                        : "secondary"
                    }
                    onClick={() => ship(warehouseTransfer)}
                  >
                    <Trans>Ship</Trans>
                  </Button>
                )}

                {receipts.length > 0 ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        leftIcon={<LuHandCoins />}
                        variant={
                          ["To Receive", "To Ship and Receive"].includes(
                            warehouseTransfer.status ?? ""
                          )
                            ? "primary"
                            : "secondary"
                        }
                        rightIcon={<LuChevronDown />}
                      >
                        <Trans>Receipts</Trans>
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      <DropdownMenuItem
                        disabled={
                          !["To Receive", "To Ship and Receive"].includes(
                            warehouseTransfer.status ?? ""
                          ) || !hasShippedItems
                        }
                        onClick={() => receive(warehouseTransfer)}
                      >
                        <DropdownMenuIcon icon={<LuCirclePlus />} />
                        <Trans>New Receipt</Trans>
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      {receipts.map((receipt) => (
                        <DropdownMenuItem key={receipt.id} asChild>
                          <Link to={path.to.receipt(receipt.id)}>
                            <DropdownMenuIcon icon={<LuHandCoins />} />
                            <HStack spacing={8}>
                              <span>{receipt.receiptId}</span>
                              <ReceiptStatus status={receipt.status} />
                            </HStack>
                          </Link>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : (
                  <Button
                    leftIcon={<LuHandCoins />}
                    isDisabled={
                      !["To Receive", "To Ship and Receive"].includes(
                        warehouseTransfer.status ?? ""
                      ) || !hasShippedItems
                    }
                    variant={
                      ["To Receive", "To Ship and Receive"].includes(
                        warehouseTransfer.status ?? ""
                      ) && hasShippedItems
                        ? "primary"
                        : "secondary"
                    }
                    onClick={() => receive(warehouseTransfer)}
                  >
                    <Trans>Receive</Trans>
                  </Button>
                )}
              </HStack>
            </CardHeader>
          ) : (
            <CardHeader>
              <Heading as="h1" size="h3">
                <Trans>New Warehouse Transfer</Trans>
              </Heading>
            </CardHeader>
          )}

          <CardContent>
            <Hidden name="id" />
            <VStack spacing={4}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full items-start">
                {isEditing ? (
                  <InputControlled
                    name="transferId"
                    label={t`Transfer ID`}
                    isReadOnly
                    value={initialValues.transferId!}
                  />
                ) : (
                  <SequenceOrCustomId
                    name="transferId"
                    label={t`Transfer ID`}
                    table="warehouseTransfer"
                  />
                )}
                <Input name="reference" label={t`Reference`} />
                <Location name="fromLocationId" label={t`From Location`} />
                <Location name="toLocationId" label={t`To Location`} />
                {isEditing && (
                  <>
                    <DatePicker name="transferDate" label={t`Transfer Date`} />
                    <DatePicker
                      name="expectedReceiptDate"
                      label={t`Expected Receipt Date`}
                    />
                  </>
                )}
              </div>
              <TextArea name="notes" label={t`Notes`} />
            </VStack>
          </CardContent>

          <CardFooter>
            <Submit disabled={!canEdit}>
              <Trans>Save</Trans>
            </Submit>
          </CardFooter>
        </Card>
      </ValidatedForm>

      <statusRules.ViolationModal />
      {deleteModal.isOpen && warehouseTransfer && (
        <ConfirmDelete
          action={path.to.deleteWarehouseTransfer(warehouseTransfer.id)}
          isOpen={deleteModal.isOpen}
          name={warehouseTransfer.transferId ?? "warehouse transfer"}
          text={t`Are you sure you want to delete ${warehouseTransfer.transferId}? This cannot be undone.`}
          onCancel={() => {
            deleteModal.onClose();
          }}
          onSubmit={() => {
            deleteModal.onClose();
          }}
        />
      )}
      {auditLogDrawer}
    </>
  );
};

const useWarehouseTransferRelatedDocuments = (warehouseTransferId?: string) => {
  const [receipts, setReceipts] = useState<
    Pick<Receipt, "id" | "receiptId" | "status">[]
  >([]);

  const [shipments, setShipments] = useState<
    Pick<Shipment, "id" | "shipmentId" | "status">[]
  >([]);

  const [hasShippedItems, setHasShippedItems] = useState(false);

  const { carbon } = useCarbon();

  const submitForm = useSubmit();

  const ship = useCallback(
    (warehouseTransfer: WarehouseTransfer) => {
      const formData = new FormData();
      formData.set("sourceDocument", "Outbound Transfer");
      formData.set("sourceDocumentId", warehouseTransfer.id);
      submitForm(formData, { method: "post", action: path.to.newShipment });
    },
    [submitForm]
  );

  const receive = useCallback(
    (warehouseTransfer: WarehouseTransfer) => {
      const formData = new FormData();
      formData.set("sourceDocument", "Inbound Transfer");
      formData.set("sourceDocumentId", warehouseTransfer.id);
      submitForm(formData, { method: "post", action: path.to.newReceipt });
    },
    [submitForm]
  );

  const getRelatedDocuments = useCallback(
    async (id: string) => {
      if (!carbon || !id) return;
      const [r, s, lines] = await Promise.all([
        carbon
          .from("receipt")
          .select("id, receiptId, status")
          .eq("sourceDocument", "Inbound Transfer")
          .eq("sourceDocumentId", id),
        carbon
          .from("shipment")
          .select("id, shipmentId, status")
          .eq("sourceDocument", "Outbound Transfer")
          .eq("sourceDocumentId", id),
        carbon
          .from("warehouseTransferLine")
          .select("shippedQuantity")
          .eq("transferId", id)
      ]);

      if (r.error) {
        toast.error("Failed to load receipts");
      } else {
        setReceipts(r.data);
      }

      if (s.error) {
        toast.error("Failed to load shipments");
      } else {
        setShipments(s.data);
      }

      if (!lines.error) {
        setHasShippedItems(
          lines.data.some((line) => (line.shippedQuantity ?? 0) > 0)
        );
      }
    },
    [carbon]
  );

  useEffect(() => {
    if (!warehouseTransferId) return;
    getRelatedDocuments(warehouseTransferId);
  }, [getRelatedDocuments, warehouseTransferId]);

  return { receipts, shipments, ship, receive, hasShippedItems };
};

export default WarehouseTransferForm;
