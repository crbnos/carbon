import { useCarbon } from "@carbon/auth";
import {
  Hidden,
  Number as NumberInput,
  Submit,
  ValidatedForm
} from "@carbon/form";
import {
  Button,
  Combobox as ComboboxBase,
  cn,
  Input,
  InputGroup,
  InputRightElement,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalTitle,
  NumberDecrementStepper,
  NumberField,
  NumberIncrementStepper,
  NumberInputGroup,
  NumberInputStepper,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast
} from "@carbon/react";
import { useCallback, useEffect, useState } from "react";
import {
  LuCheck,
  LuChevronDown,
  LuChevronUp,
  LuList,
  LuQrCode
} from "react-icons/lu";
import { useFetcher } from "react-router";
import { z } from "zod/v3";
import { Item, UnitOfMeasure } from "~/components/Form";
import { MethodItemType } from "~/modules/shared/types";
import { path } from "~/utils/path";

export const maintenanceAddPartValidator = z.object({
  itemId: z.string().min(1, { message: "Item is required" }),
  unitOfMeasureCode: z
    .string()
    .min(1, { message: "Unit of measure is required" }),
  quantity: z.coerce.number().optional(),
  children: z.string().optional()
});

interface ItemDetails {
  id: string;
  name: string;
  unitOfMeasureCode: string;
  itemTrackingType: "Serial" | "Batch" | "Inventory" | null;
}

export function MaintenanceAddPartModal({
  dispatchId,
  onClose
}: {
  dispatchId: string;
  onClose: () => void;
}) {
  const fetcher = useFetcher<{ success: boolean; message: string }>();
  const { carbon } = useCarbon();

  const [selectedItemId, setSelectedItemId] = useState<string>("");
  const [itemDetails, setItemDetails] = useState<ItemDetails | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [isLoadingItem, setIsLoadingItem] = useState(false);
  const [itemType, setItemType] = useState<MethodItemType | "Item">("Item");
  const [unitOfMeasureCode, setUnitOfMeasureCode] = useState("EA");

  // For serial tracking
  const [selectedSerialNumbers, setSelectedSerialNumbers] = useState<
    Array<{ index: number; id: string }>
  >([{ index: 0, id: "" }]);
  const [serialErrors, setSerialErrors] = useState<Record<number, string>>({});
  const [serialOptions, setSerialOptions] = useState<
    Array<{ label: string; value: string; helper?: string }>
  >([]);

  // For batch tracking
  const [selectedBatches, setSelectedBatches] = useState<
    Array<{ index: number; id: string; quantity: number }>
  >([{ index: 0, id: "", quantity: 1 }]);
  const [batchErrors, setBatchErrors] = useState<Record<number, string>>({});
  const [batchOptions, setBatchOptions] = useState<
    Array<{ label: string; value: string; helper?: string; quantity: number }>
  >([]);

  const [activeTab, setActiveTab] = useState("scan");

  const handleItemChange = useCallback(
    async (option: { value: string } | null) => {
      const itemId = option?.value ?? "";
      setSelectedItemId(itemId);
      setItemDetails(null);
      setQuantity(1);
      setSelectedSerialNumbers([{ index: 0, id: "" }]);
      setSelectedBatches([{ index: 0, id: "", quantity: 1 }]);
      setSerialErrors({});
      setBatchErrors({});
      setSerialOptions([]);
      setBatchOptions([]);

      if (itemId && carbon) {
        setIsLoadingItem(true);
        const { data } = await carbon
          .from("item")
          .select("id, name, unitOfMeasureCode, itemTrackingType")
          .eq("id", itemId)
          .single();

        if (data) {
          setItemDetails(data as ItemDetails);
          setUnitOfMeasureCode(data.unitOfMeasureCode ?? "EA");

          // Fetch serial numbers if serial tracked
          if (data.itemTrackingType === "Serial") {
            const { data: serials } = await carbon
              .from("trackedEntity")
              .select("id, readableId, status")
              .eq("sourceDocumentId", itemId)
              .eq("status", "Available");

            setSerialOptions(
              serials?.map((sn) => ({
                label: sn.id ?? "",
                value: sn.id,
                helper: sn.readableId ? `Serial ${sn.readableId}` : undefined
              })) ?? []
            );
          }

          // Fetch batch numbers if batch tracked
          if (data.itemTrackingType === "Batch") {
            const { data: batches } = await carbon
              .from("trackedEntity")
              .select("id, readableId, status, quantity")
              .eq("sourceDocumentId", itemId)
              .eq("status", "Available");

            setBatchOptions(
              batches?.map((batch) => ({
                label: batch.id ?? "",
                value: batch.id,
                helper: batch.readableId
                  ? `Batch ${batch.readableId} (${batch.quantity} available)`
                  : `${batch.quantity} available`,
                quantity: batch.quantity ?? 0
              })) ?? []
            );
          }
        }
        setIsLoadingItem(false);
      }
    },
    [carbon]
  );

  const validateSerialNumber = useCallback(
    (value: string, index: number) => {
      if (!value) return "Serial number is required";
      const isDuplicate = selectedSerialNumbers.some(
        (sn, i) => sn.id === value && i !== index
      );
      if (isDuplicate) return "Duplicate serial number";
      const isValid = serialOptions.some((opt) => opt.value === value);
      if (!isValid) return "Serial number is not available";
      return null;
    },
    [selectedSerialNumbers, serialOptions]
  );

  const validateBatch = useCallback(
    (value: string, qty: number, index: number) => {
      if (!value) return "Batch number is required";
      if (qty <= 0) return "Quantity must be greater than 0";
      const isDuplicate = selectedBatches.some(
        (b, i) => b.id === value && i !== index
      );
      if (isDuplicate) return "Duplicate batch number";
      const batch = batchOptions.find((b) => b.value === value);
      if (!batch) return "Batch is not available";
      if (qty > batch.quantity) return `Only ${batch.quantity} available`;
      return null;
    },
    [selectedBatches, batchOptions]
  );

  const handleSubmit = useCallback(
    (
      _data: z.infer<typeof maintenanceAddPartValidator>,
      e: React.FormEvent<HTMLFormElement>
    ) => {
      e.preventDefault();

      if (!selectedItemId || !itemDetails) {
        toast.error("Please select an item");
        return;
      }

      const trackingType = itemDetails.itemTrackingType;

      if (trackingType === "Serial") {
        let hasErrors = false;
        const newErrors: Record<number, string> = {};
        selectedSerialNumbers.forEach((sn) => {
          const error = validateSerialNumber(sn.id, sn.index);
          if (error) {
            newErrors[sn.index] = error;
            hasErrors = true;
          }
        });
        setSerialErrors(newErrors);
        if (hasErrors) return;

        const payload = {
          itemId: selectedItemId,
          unitOfMeasureCode,
          children: selectedSerialNumbers.map((sn) => ({
            trackedEntityId: sn.id,
            quantity: 1
          }))
        };

        fetcher.submit(JSON.stringify(payload), {
          method: "post",
          action: path.to.addAndIssueMaintenanceDispatchItem(dispatchId),
          encType: "application/json"
        });
      } else if (trackingType === "Batch") {
        let hasErrors = false;
        const newErrors: Record<number, string> = {};
        selectedBatches.forEach((batch) => {
          const error = validateBatch(batch.id, batch.quantity, batch.index);
          if (error) {
            newErrors[batch.index] = error;
            hasErrors = true;
          }
        });
        setBatchErrors(newErrors);
        if (hasErrors) return;

        const payload = {
          itemId: selectedItemId,
          unitOfMeasureCode,
          children: selectedBatches.map((batch) => ({
            trackedEntityId: batch.id,
            quantity: batch.quantity
          }))
        };

        fetcher.submit(JSON.stringify(payload), {
          method: "post",
          action: path.to.addAndIssueMaintenanceDispatchItem(dispatchId),
          encType: "application/json"
        });
      } else {
        if (quantity <= 0) {
          toast.error("Quantity must be greater than 0");
          return;
        }

        const payload = {
          itemId: selectedItemId,
          unitOfMeasureCode,
          quantity
        };

        fetcher.submit(JSON.stringify(payload), {
          method: "post",
          action: path.to.addAndIssueMaintenanceDispatchItem(dispatchId),
          encType: "application/json"
        });
      }
    },
    [
      selectedItemId,
      itemDetails,
      quantity,
      unitOfMeasureCode,
      selectedSerialNumbers,
      selectedBatches,
      validateSerialNumber,
      validateBatch,
      dispatchId,
      fetcher
    ]
  );

  useEffect(() => {
    if (fetcher.data?.success) {
      onClose();
      if (fetcher.data.message) {
        toast.success(fetcher.data.message);
      }
    } else if (fetcher.data?.message) {
      toast.error(fetcher.data.message);
    }
  }, [fetcher.data, onClose]);

  return (
    <Modal open onOpenChange={onClose}>
      <ModalContent>
        <ModalTitle>Add Spare Part</ModalTitle>
        <ModalDescription>
          Select an item and specify the quantity to issue
        </ModalDescription>
        <ValidatedForm
          method="post"
          action={path.to.addAndIssueMaintenanceDispatchItem(dispatchId)}
          validator={maintenanceAddPartValidator}
          onSubmit={handleSubmit}
          defaultValues={{
            itemId: "",
            unitOfMeasureCode: "EA",
            quantity: 1
          }}
        >
          <ModalBody>
            <div className="flex flex-col gap-4">
              <Hidden name="itemId" value={selectedItemId} />
              <Hidden name="unitOfMeasureCode" value={unitOfMeasureCode} />
              {/* Item Selection */}
              <Item
                name="itemIdSelect"
                label={itemType}
                type={itemType}
                onChange={handleItemChange}
                onTypeChange={(t) => setItemType(t as MethodItemType)}
              />

              {isLoadingItem && (
                <div className="text-sm text-muted-foreground">
                  Loading item details...
                </div>
              )}

              {/* Inventory Item - Simple Quantity */}
              {itemDetails &&
                (itemDetails.itemTrackingType === "Inventory" ||
                  !itemDetails.itemTrackingType) && (
                  <>
                    <NumberInput
                      name="quantity"
                      label="Quantity"
                      value={quantity}
                      onChange={(value) => setQuantity(value)}
                      minValue={1}
                    />
                    <UnitOfMeasure
                      name="unitOfMeasureCodeDisplay"
                      label="Unit of Measure"
                      value={unitOfMeasureCode}
                      isReadOnly
                    />
                  </>
                )}

              {/* Serial Tracked Item */}
              {itemDetails && itemDetails.itemTrackingType === "Serial" && (
                <Tabs value={activeTab} onValueChange={setActiveTab}>
                  <TabsList className="grid w-full grid-cols-2 mb-4">
                    <TabsTrigger value="scan">
                      <LuQrCode className="mr-2" />
                      Scan
                    </TabsTrigger>
                    <TabsTrigger value="select">
                      <LuList className="mr-2" />
                      Select
                    </TabsTrigger>
                  </TabsList>
                  <TabsContent value="scan">
                    <div className="flex flex-col gap-4">
                      {selectedSerialNumbers.map((sn, index) => (
                        <div
                          key={`${index}-scan`}
                          className="flex flex-col gap-1"
                        >
                          <div className="flex items-center gap-2">
                            <div className="flex-1">
                              <InputGroup>
                                <Input
                                  placeholder={`Serial Number ${index + 1}`}
                                  value={sn.id}
                                  onChange={(e) => {
                                    const newValue = e.target.value;
                                    setSelectedSerialNumbers((prev) => {
                                      const updated = [...prev];
                                      updated[index] = { index, id: newValue };
                                      return updated;
                                    });
                                  }}
                                  onBlur={(e) => {
                                    const error = validateSerialNumber(
                                      e.target.value,
                                      index
                                    );
                                    setSerialErrors((prev) => {
                                      const newErrors = { ...prev };
                                      if (error) {
                                        newErrors[index] = error;
                                      } else {
                                        delete newErrors[index];
                                      }
                                      return newErrors;
                                    });
                                  }}
                                  className={cn(
                                    serialErrors[index] && "border-destructive"
                                  )}
                                />
                                <InputRightElement className="pl-2">
                                  {!serialErrors[index] && sn.id ? (
                                    <LuCheck className="text-emerald-500" />
                                  ) : (
                                    <LuQrCode />
                                  )}
                                </InputRightElement>
                              </InputGroup>
                            </div>
                          </div>
                          {serialErrors[index] && (
                            <span className="text-xs text-destructive">
                              {serialErrors[index]}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </TabsContent>
                  <TabsContent value="select">
                    <div className="flex flex-col gap-4">
                      {selectedSerialNumbers.map((sn, index) => (
                        <div
                          key={`${index}-select`}
                          className="flex flex-col gap-1"
                        >
                          <div className="flex items-center gap-2">
                            <div className="flex-1">
                              <ComboboxBase
                                placeholder={`Select Serial ${index + 1}`}
                                value={sn.id}
                                onChange={(value) => {
                                  setSelectedSerialNumbers((prev) => {
                                    const updated = [...prev];
                                    updated[index] = { index, id: value };
                                    return updated;
                                  });
                                  const error = validateSerialNumber(
                                    value,
                                    index
                                  );
                                  setSerialErrors((prev) => {
                                    const newErrors = { ...prev };
                                    if (error) {
                                      newErrors[index] = error;
                                    } else {
                                      delete newErrors[index];
                                    }
                                    return newErrors;
                                  });
                                }}
                                options={serialOptions}
                              />
                            </div>
                          </div>
                          {serialErrors[index] && (
                            <span className="text-xs text-destructive">
                              {serialErrors[index]}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </TabsContent>
                </Tabs>
              )}

              {/* Batch Tracked Item */}
              {itemDetails && itemDetails.itemTrackingType === "Batch" && (
                <Tabs value={activeTab} onValueChange={setActiveTab}>
                  <TabsList className="grid w-full grid-cols-2 mb-4">
                    <TabsTrigger value="scan">
                      <LuQrCode className="mr-2" />
                      Scan
                    </TabsTrigger>
                    <TabsTrigger value="select">
                      <LuList className="mr-2" />
                      Select
                    </TabsTrigger>
                  </TabsList>
                  <TabsContent value="scan">
                    <div className="flex flex-col gap-4">
                      {selectedBatches.map((batch, index) => (
                        <div
                          key={`${index}-scan`}
                          className="flex flex-col gap-1"
                        >
                          <div className="flex items-center gap-2">
                            <div className="flex-1">
                              <InputGroup>
                                <Input
                                  placeholder={`Batch Number ${index + 1}`}
                                  value={batch.id}
                                  onChange={(e) => {
                                    const newValue = e.target.value;
                                    setSelectedBatches((prev) => {
                                      const updated = [...prev];
                                      updated[index] = {
                                        ...batch,
                                        id: newValue
                                      };
                                      return updated;
                                    });
                                  }}
                                  onBlur={(e) => {
                                    const error = validateBatch(
                                      e.target.value,
                                      batch.quantity,
                                      index
                                    );
                                    setBatchErrors((prev) => {
                                      const newErrors = { ...prev };
                                      if (error) {
                                        newErrors[index] = error;
                                      } else {
                                        delete newErrors[index];
                                      }
                                      return newErrors;
                                    });
                                  }}
                                  className={cn(
                                    batchErrors[index] && "border-destructive"
                                  )}
                                />
                                <InputRightElement className="pl-2">
                                  {!batchErrors[index] && batch.id ? (
                                    <LuCheck className="text-emerald-500" />
                                  ) : (
                                    <LuQrCode />
                                  )}
                                </InputRightElement>
                              </InputGroup>
                            </div>
                            <div className="w-20">
                              <NumberField
                                value={batch.quantity}
                                onChange={(value) => {
                                  setSelectedBatches((prev) => {
                                    const updated = [...prev];
                                    updated[index] = {
                                      ...batch,
                                      quantity: value
                                    };
                                    return updated;
                                  });
                                }}
                                minValue={1}
                              >
                                <NumberInputGroup className="relative">
                                  <NumberInput name="quantity" />
                                  <NumberInputStepper>
                                    <NumberIncrementStepper>
                                      <LuChevronUp />
                                    </NumberIncrementStepper>
                                    <NumberDecrementStepper>
                                      <LuChevronDown />
                                    </NumberDecrementStepper>
                                  </NumberInputStepper>
                                </NumberInputGroup>
                              </NumberField>
                            </div>
                          </div>
                          {batchErrors[index] && (
                            <span className="text-xs text-destructive">
                              {batchErrors[index]}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </TabsContent>
                  <TabsContent value="select">
                    <div className="flex flex-col gap-4">
                      {selectedBatches.map((batch, index) => (
                        <div
                          key={`${index}-select`}
                          className="flex flex-col gap-1"
                        >
                          <div className="flex items-center gap-2">
                            <div className="flex-1">
                              <ComboboxBase
                                placeholder={`Select Batch ${index + 1}`}
                                value={batch.id}
                                onChange={(value) => {
                                  setSelectedBatches((prev) => {
                                    const updated = [...prev];
                                    updated[index] = { ...batch, id: value };
                                    return updated;
                                  });
                                  const error = validateBatch(
                                    value,
                                    batch.quantity,
                                    index
                                  );
                                  setBatchErrors((prev) => {
                                    const newErrors = { ...prev };
                                    if (error) {
                                      newErrors[index] = error;
                                    } else {
                                      delete newErrors[index];
                                    }
                                    return newErrors;
                                  });
                                }}
                                options={batchOptions}
                              />
                            </div>
                            <div className="w-20">
                              <NumberField
                                value={batch.quantity}
                                onChange={(value) => {
                                  setSelectedBatches((prev) => {
                                    const updated = [...prev];
                                    updated[index] = {
                                      ...batch,
                                      quantity: value
                                    };
                                    return updated;
                                  });
                                }}
                                minValue={1}
                              >
                                <NumberInputGroup>
                                  <NumberInput name="quantity" />
                                  <NumberInputStepper>
                                    <NumberIncrementStepper />
                                    <NumberDecrementStepper />
                                  </NumberInputStepper>
                                </NumberInputGroup>
                              </NumberField>
                            </div>
                          </div>
                          {batchErrors[index] && (
                            <span className="text-xs text-destructive">
                              {batchErrors[index]}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </TabsContent>
                </Tabs>
              )}
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Submit
              isLoading={fetcher.state !== "idle"}
              isDisabled={
                fetcher.state !== "idle" || !selectedItemId || isLoadingItem
              }
              withBlocker={false}
            >
              Add & Issue
            </Submit>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
}
