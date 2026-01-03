import { useCarbon } from "@carbon/auth";
import {
  Input as FormInput,
  Number as FormNumberInput,
  Hidden,
  ValidatedForm
} from "@carbon/form";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Checkbox,
  Combobox as ComboboxBase,
  cn,
  IconButton,
  Input,
  InputGroup,
  InputRightElement,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  NumberDecrementStepper,
  NumberField,
  NumberIncrementStepper,
  NumberInput,
  NumberInputGroup,
  NumberInputStepper,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
  useDisclosure
} from "@carbon/react";

import { getItemReadableId } from "@carbon/utils";
import { useNumberFormatter } from "@react-aria/i18n";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LuArrowRightLeft,
  LuCheck,
  LuChevronDown,
  LuChevronUp,
  LuCirclePlus,
  LuGitBranch,
  LuList,
  LuPrinter,
  LuQrCode,
  LuScale,
  LuTrash,
  LuUndo2,
  LuX
} from "react-icons/lu";
import { useFetcher } from "react-router";
import type {
  getBatchNumbersForItem,
  getSerialNumbersForItem
} from "~/services/inventory.service";
import { convertEntityValidator, issueValidator } from "~/services/models";
import type { JobMaterial, TrackedInput } from "~/services/types";
import { useItems } from "~/stores";
import { path } from "~/utils/path";

type TrackingType = "Serial" | "Batch" | "Inventory" | null;

interface ItemDetails {
  id: string;
  name: string;
  unitOfMeasureCode: string;
  itemTrackingType: TrackingType;
}

export function IssueMaterialModal({
  operationId,
  material,
  parentId,
  parentIdIsSerialized,
  trackedInputs = [],
  onClose
}: {
  operationId: string;
  material?: JobMaterial;
  parentId?: string;
  parentIdIsSerialized?: boolean;
  trackedInputs?: TrackedInput[];
  onClose: () => void;
}) {
  const { carbon } = useCarbon();
  const [items] = useItems();
  const numberFormatter = useNumberFormatter({ maximumFractionDigits: 4 });

  // Item selection state
  const [selectedItemId, setSelectedItemId] = useState<string>(
    material?.itemId ?? ""
  );
  const [itemDetails, setItemDetails] = useState<ItemDetails | null>(null);
  const [isLoadingItem, setIsLoadingItem] = useState(false);

  // Determine tracking type from material or item details
  const trackingType: TrackingType = useMemo(() => {
    if (material) {
      if (material.requiresSerialTracking) return "Serial";
      if (material.requiresBatchTracking) return "Batch";
      return "Inventory";
    }
    return itemDetails?.itemTrackingType ?? null;
  }, [material, itemDetails]);

  // Item options for the combobox
  const itemOptions = useMemo(() => {
    return items.map((item) => ({
      label: item.readableIdWithRevision,
      helper: item.name,
      value: item.id
    }));
  }, [items]);

  // Serial number state and options
  const { data: serialNumbers } = useSerialNumbers(
    trackingType === "Serial" ? selectedItemId : undefined
  );
  const serialOptions = useMemo(() => {
    return (
      serialNumbers?.data?.map((sn) => ({
        label: sn.id ?? "",
        value: sn.id,
        helper: sn.readableId ? `Serial ${sn.readableId}` : undefined
      })) ?? []
    );
  }, [serialNumbers]);

  // Batch number state and options
  const { data: batchNumbers } = useBatchNumbers(
    trackingType === "Batch" ? selectedItemId : undefined
  );
  const batchOptions = useMemo(() => {
    return (
      batchNumbers?.data
        ?.filter((bn) => bn.status === "Available")
        .map((bn) => {
          return {
            label: bn.sourceDocumentReadableId ?? "",
            value: bn.id,
            helper: bn.readableId
              ? `${bn.id.slice(0, 10)} - ${bn.quantity} Available of Batch ${bn.readableId}`
              : `${bn.id.slice(0, 10)} - ${bn.quantity} Available`,
            availableQuantity: bn.quantity
          };
        }) ?? []
    );
  }, [batchNumbers]);

  // Unconsume options for batch
  const unconsumeOptions = useMemo(() => {
    return trackedInputs.map((input) => ({
      label: input.id,
      value: input.id,
      helper: `${input.quantity} ${input.readableId ? `of Batch ${input.readableId}` : ""}`
    }));
  }, [trackedInputs]);

  // Quantity for inventory items
  const initialQuantity = useMemo(() => {
    if (!material) return 1;
    return parentIdIsSerialized
      ? (material.quantity ?? material.estimatedQuantity ?? 1)
      : (material.estimatedQuantity ?? material.quantity ?? 1);
  }, [material, parentIdIsSerialized]);

  const [quantity, setQuantity] = useState(initialQuantity);

  // Serial numbers selection state
  const [selectedSerialNumbers, setSelectedSerialNumbers] = useState<
    Array<{ index: number; id: string }>
  >(
    Array(Math.max(1, initialQuantity))
      .fill("")
      .map((_, index) => ({ index, id: "" }))
  );
  const [serialErrors, setSerialErrors] = useState<Record<number, string>>({});
  const [selectedTrackedInputs, setSelectedTrackedInputs] = useState<string[]>(
    []
  );

  // Batch numbers selection state
  const [selectedBatchNumbers, setSelectedBatchNumbers] = useState<
    Array<{ index: number; id: string; quantity: number }>
  >([{ index: 0, id: "", quantity: initialQuantity }]);
  const [batchErrors, setBatchErrors] = useState<Record<number, string>>({});
  const [unconsumedBatch, setUnconsumedBatch] = useState("");

  // Tab state
  const [activeTab, setActiveTab] = useState("scan");

  // Split entities result state (for batch splitting)
  const [splitEntitiesResult, setSplitEntitiesResult] = useState<
    {
      newId: string;
      originalId: string;
      quantity: number;
      readableId?: string;
    }[]
  >([]);

  // Fetchers
  const fetcher = useFetcher<{
    success: boolean;
    message: string;
    splitEntities?: Array<{
      originalId: string;
      newId: string;
      quantity: number;
      readableId?: string;
    }>;
  }>();
  const unconsumeFetcher = useFetcher<{ success: boolean; message: string }>();
  const inventoryFetcher = useFetcher<{ success: boolean; message: string }>();

  // Sub-modals for batch splitting
  const convertDisclosure = useDisclosure();
  const scrapDisclosure = useDisclosure();
  const [trackedEntity, setTrackedEntity] = useState<string | null>(null);

  // Fetch item details when item is selected (only when no material provided)
  const handleItemChange = useCallback(
    async (itemId: string) => {
      setSelectedItemId(itemId);
      setItemDetails(null);
      setQuantity(1);
      setSelectedSerialNumbers([{ index: 0, id: "" }]);
      setSelectedBatchNumbers([{ index: 0, id: "", quantity: 1 }]);
      setSerialErrors({});
      setBatchErrors({});

      if (itemId && carbon && !material) {
        setIsLoadingItem(true);
        const { data } = await carbon
          .from("item")
          .select("id, name, unitOfMeasureCode, itemTrackingType")
          .eq("id", itemId)
          .single();

        if (data) {
          setItemDetails(data as ItemDetails);
        }
        setIsLoadingItem(false);
      }
    },
    [carbon, material]
  );

  // Validation functions
  const validateSerialNumber = useCallback(
    (value: string, index: number) => {
      if (!value) return "Serial number is required";
      const isDuplicate = selectedSerialNumbers.some(
        (sn, i) => sn.id === value && i !== index
      );
      if (isDuplicate) return "Duplicate serial number";
      const isValid = serialOptions.some((opt) => opt.value === value);
      if (!isValid) {
        const sn = serialNumbers?.data?.find((s) => s.id === value);
        if (sn) return `Serial number is ${sn.status}`;
        return "Serial number is not available";
      }
      return null;
    },
    [selectedSerialNumbers, serialOptions, serialNumbers?.data]
  );

  const validateBatchNumber = useCallback(
    (value: string, qty: number, index: number) => {
      if (!value) return "Batch number is required";
      const isDuplicate = selectedBatchNumbers.some(
        (bn, i) => bn.id === value && i !== index
      );
      if (isDuplicate) return "Duplicate batch number";
      const batchOption = batchOptions.find((opt) => opt.value === value);
      if (!batchOption) {
        const bn = batchNumbers?.data?.find((b) => b.id === value);
        if (bn) return `Batch number is ${bn.status}`;
        return "Batch number is not available";
      }
      if (qty <= 0) return "Quantity must be greater than 0";
      if (qty > batchOption.availableQuantity)
        return `Quantity cannot exceed available quantity (${batchOption.availableQuantity})`;
      return null;
    },
    [selectedBatchNumbers, batchOptions, batchNumbers?.data]
  );

  // Update functions for serial numbers
  const updateSerialNumber = useCallback(
    (serialNumber: { index: number; id: string }) => {
      setSelectedSerialNumbers((prev) => {
        const newSerialNumbers = [...prev];
        newSerialNumbers[serialNumber.index] = serialNumber;
        return newSerialNumbers;
      });
    },
    []
  );

  const addSerialNumber = useCallback(() => {
    setSelectedSerialNumbers((prev) => {
      const newIndex = prev.length;
      return [...prev, { index: newIndex, id: "" }];
    });
  }, []);

  const removeSerialNumber = useCallback((indexToRemove: number) => {
    setSelectedSerialNumbers((prev) => {
      const filtered = prev.filter((_, i) => i !== indexToRemove);
      return filtered.map((item, i) => ({ ...item, index: i }));
    });
    setSerialErrors((prev) => {
      const newErrors = { ...prev };
      delete newErrors[indexToRemove];
      const reindexedErrors: Record<number, string> = {};
      Object.entries(newErrors).forEach(([key, value]) => {
        const keyNum = parseInt(key);
        if (keyNum > indexToRemove) {
          reindexedErrors[keyNum - 1] = value;
        } else {
          reindexedErrors[keyNum] = value;
        }
      });
      return reindexedErrors;
    });
  }, []);

  // Update functions for batch numbers
  const updateBatchNumber = useCallback(
    (batchNumber: { index: number; id: string; quantity: number }) => {
      setSelectedBatchNumbers((prev) => {
        const newBatchNumbers = [...prev];
        newBatchNumbers[batchNumber.index] = batchNumber;
        return newBatchNumbers;
      });
    },
    []
  );

  const addBatchNumber = useCallback(() => {
    setSelectedBatchNumbers((prev) => {
      const newIndex = prev.length;
      return [...prev, { index: newIndex, id: "", quantity: 1 }];
    });
  }, []);

  const removeBatchNumber = useCallback((indexToRemove: number) => {
    setSelectedBatchNumbers((prev) => {
      const filtered = prev.filter((_, i) => i !== indexToRemove);
      return filtered.map((item, i) => ({ ...item, index: i }));
    });
    setBatchErrors((prev) => {
      const newErrors = { ...prev };
      delete newErrors[indexToRemove];
      const reindexedErrors: Record<number, string> = {};
      Object.entries(newErrors).forEach(([key, value]) => {
        const keyNum = parseInt(key);
        if (keyNum > indexToRemove) {
          reindexedErrors[keyNum - 1] = value;
        } else {
          reindexedErrors[keyNum] = value;
        }
      });
      return reindexedErrors;
    });
  }, []);

  const validateBatchInput = useCallback(
    (value: string, index: number) => {
      if (!value) {
        setBatchErrors((prev) => ({
          ...prev,
          [index]: "Batch number is required"
        }));
        return false;
      }

      const duplicateIndices = selectedBatchNumbers
        .map((bn, i) => (bn.id === value && i !== index ? i : -1))
        .filter((i) => i !== -1);

      if (duplicateIndices.length > 0) {
        setBatchErrors((prev) => ({
          ...prev,
          [index]: "Duplicate batch number"
        }));
        return false;
      }

      const batchOption = batchOptions.find((opt) => opt.value === value);
      if (!batchOption) {
        setBatchErrors((prev) => ({
          ...prev,
          [index]: "Batch number is not available"
        }));
        return false;
      }

      const currentBatchNumber = selectedBatchNumbers[index];
      if (currentBatchNumber.quantity > batchOption.availableQuantity) {
        const remainingQuantity =
          currentBatchNumber.quantity - batchOption.availableQuantity;

        updateBatchNumber({
          ...currentBatchNumber,
          id: value,
          quantity: batchOption.availableQuantity
        });

        setSelectedBatchNumbers((prev) => {
          const newIndex = prev.length;
          return [
            ...prev,
            { index: newIndex, id: "", quantity: remainingQuantity }
          ];
        });
      }

      setBatchErrors((prev) => {
        const newErrors = { ...prev };
        delete newErrors[index];
        return newErrors;
      });
      return true;
    },
    [selectedBatchNumbers, batchOptions, updateBatchNumber]
  );

  const toggleTrackedInput = useCallback((id: string) => {
    setSelectedTrackedInputs((prev) => {
      if (prev.includes(id)) {
        return prev.filter((item) => item !== id);
      }
      return [...prev, id];
    });
  }, []);

  // Submit handlers
  const handleSubmitSerial = useCallback(() => {
    if (!parentId) {
      toast.error("Parent tracking ID is required for serial tracked items.");
      return;
    }

    // Either material.id or (operationId + selectedItemId) must be provided
    if (!material?.id && !selectedItemId) {
      toast.error("Please select an item to issue.");
      return;
    }

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

    if (!hasErrors) {
      const payload = material?.id
        ? {
            materialId: material.id,
            parentTrackedEntityId: parentId,
            children: selectedSerialNumbers.map((sn) => ({
              trackedEntityId: sn.id,
              quantity: 1
            }))
          }
        : {
            jobOperationId: operationId,
            itemId: selectedItemId,
            parentTrackedEntityId: parentId,
            children: selectedSerialNumbers.map((sn) => ({
              trackedEntityId: sn.id,
              quantity: 1
            }))
          };

      fetcher.submit(JSON.stringify(payload), {
        method: "post",
        action: path.to.issueTrackedEntity,
        encType: "application/json"
      });
    }
  }, [
    selectedSerialNumbers,
    validateSerialNumber,
    parentId,
    material?.id,
    operationId,
    selectedItemId,
    fetcher
  ]);

  const handleSubmitBatch = useCallback(() => {
    if (!parentId) {
      toast.error("Parent tracking ID is required for batch tracked items.");
      return;
    }

    // Either material.id or (operationId + selectedItemId) must be provided
    if (!material?.id && !selectedItemId) {
      toast.error("Please select an item to issue.");
      return;
    }

    let hasErrors = false;
    const newErrors: Record<number, string> = {};

    selectedBatchNumbers.forEach((bn) => {
      const error = validateBatchNumber(bn.id, bn.quantity, bn.index);
      if (error) {
        newErrors[bn.index] = error;
        hasErrors = true;
      }
    });

    setBatchErrors(newErrors);

    if (!hasErrors) {
      const payload = material?.id
        ? {
            materialId: material.id,
            parentTrackedEntityId: parentId,
            children: selectedBatchNumbers.map((bn) => ({
              trackedEntityId: bn.id,
              quantity: bn.quantity
            }))
          }
        : {
            jobOperationId: operationId,
            itemId: selectedItemId,
            parentTrackedEntityId: parentId,
            children: selectedBatchNumbers.map((bn) => ({
              trackedEntityId: bn.id,
              quantity: bn.quantity
            }))
          };

      fetcher.submit(JSON.stringify(payload), {
        method: "post",
        action: path.to.issueTrackedEntity,
        encType: "application/json"
      });
    }
  }, [
    selectedBatchNumbers,
    validateBatchNumber,
    parentId,
    material?.id,
    operationId,
    selectedItemId,
    fetcher
  ]);

  const handleUnconsumeSerial = useCallback(() => {
    if (selectedTrackedInputs.length === 0) {
      toast.error("Please select at least one item to unconsume");
      return;
    }

    if (!material?.id || !parentId) {
      toast.error("Material and parent ID are required to unconsume");
      return;
    }

    const payload = {
      materialId: material.id,
      parentTrackedEntityId: parentId,
      children: selectedTrackedInputs.map((id) => ({
        trackedEntityId: id,
        quantity: 1
      }))
    };

    unconsumeFetcher.submit(JSON.stringify(payload), {
      method: "post",
      action: path.to.unconsume,
      encType: "application/json"
    });
  }, [selectedTrackedInputs, material?.id, parentId, unconsumeFetcher]);

  const handleUnconsumeBatch = useCallback(() => {
    if (!unconsumedBatch) {
      toast.error("Please select a batch to unconsume");
      return;
    }

    if (!material?.id || !parentId) {
      toast.error("Material and parent ID are required to unconsume");
      return;
    }

    const payload = {
      materialId: material.id,
      parentTrackedEntityId: parentId,
      children: [
        {
          trackedEntityId: unconsumedBatch,
          quantity:
            trackedInputs.find((input) => input.id === unconsumedBatch)
              ?.quantity ?? 0
        }
      ]
    };

    unconsumeFetcher.submit(JSON.stringify(payload), {
      method: "post",
      action: path.to.unconsume,
      encType: "application/json"
    });
  }, [
    unconsumedBatch,
    material?.id,
    parentId,
    trackedInputs,
    unconsumeFetcher
  ]);

  // Handle fetcher responses
  const processedFetcherData = useRef<typeof fetcher.data | null>(null);

  useEffect(() => {
    if (
      fetcher.state === "idle" &&
      fetcher.data &&
      fetcher.data !== processedFetcherData.current
    ) {
      processedFetcherData.current = fetcher.data;

      if (fetcher.data.success) {
        if (
          fetcher.data.splitEntities &&
          fetcher.data.splitEntities.length > 0
        ) {
          setSplitEntitiesResult(
            fetcher.data.splitEntities.map((entity) => ({
              newId: entity.newId,
              originalId: entity.originalId,
              readableId: entity.readableId,
              quantity: entity.quantity
            }))
          );
          toast.success(fetcher.data.message);
        } else {
          onClose();
          if (fetcher.data.message) {
            toast.success(fetcher.data.message);
          }
        }
      } else if (fetcher.data.message) {
        toast.error(fetcher.data.message);
      }
    }
  }, [fetcher.state, fetcher.data, onClose]);

  useEffect(() => {
    if (unconsumeFetcher.data?.success) {
      onClose();
      if (unconsumeFetcher.data.message) {
        toast.success(unconsumeFetcher.data.message);
      }
    } else if (unconsumeFetcher.data?.message) {
      toast.error(unconsumeFetcher.data.message);
    }
  }, [unconsumeFetcher.data, onClose]);

  useEffect(() => {
    if (inventoryFetcher.data?.success) {
      onClose();
    }
  }, [inventoryFetcher.data, onClose]);

  // Determine what to render based on state
  const showItemSelector = !material?.itemId;
  const showContent = material?.itemId || itemDetails;

  const hasTrackedInputs = trackedInputs.length > 0;

  return (
    <>
      <Modal open onOpenChange={onClose}>
        <ModalContent>
          <ModalHeader>
            <ModalTitle>
              {material?.description ??
                getItemReadableId(items, selectedItemId) ??
                "Issue Material"}
            </ModalTitle>
            {!material && (
              <ModalDescription>
                Select an item and specify the quantity to issue
              </ModalDescription>
            )}
          </ModalHeader>

          {splitEntitiesResult.length > 0 ? (
            // Show split entities result
            <ModalBody>
              <Alert variant="default" className="mb-4">
                <LuGitBranch className="mr-2" />
                <AlertTitle>Batch Split Occurred</AlertTitle>
                <AlertDescription>
                  <div className="flex flex-col gap-2">
                    <p>A new batch entity was created from a split:</p>
                    <ul className="list-disc list-inside space-y-1">
                      {splitEntitiesResult.map((split) => (
                        <li key={split.newId} className="flex flex-col text-sm">
                          <span className="text-md font-semibold">
                            {split.readableId ??
                              getItemReadableId(items, material?.itemId) ??
                              "Material"}
                          </span>
                          <div className="flex gap-2 items-center">
                            <span className="font-mono flex gap-1 items-center">
                              <LuQrCode />
                              {split.newId}
                            </span>
                            <span className="font-mono text-xs text-muted-foreground flex gap-1 items-center truncate">
                              <LuScale />
                              {numberFormatter.format(split.quantity)}
                            </span>
                          </div>
                          <div className="flex gap-2 mt-4">
                            <Button
                              variant="primary"
                              leftIcon={<LuPrinter />}
                              onClick={() => {
                                window.open(
                                  window.location.origin +
                                    path.to.file.trackedEntityLabelPdf(
                                      split.newId
                                    ),
                                  "_blank"
                                );
                              }}
                            >
                              Print Label
                            </Button>
                            <Button
                              variant="secondary"
                              leftIcon={<LuArrowRightLeft />}
                              onClick={() => {
                                setTrackedEntity(split.newId);
                                convertDisclosure.onOpen();
                              }}
                            >
                              Convert
                            </Button>
                            <Button
                              variant="secondary"
                              leftIcon={<LuTrash />}
                              onClick={() => {
                                setTrackedEntity(split.newId);
                                scrapDisclosure.onOpen();
                              }}
                            >
                              Scrap
                            </Button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                </AlertDescription>
              </Alert>
            </ModalBody>
          ) : trackingType === "Inventory" || trackingType === null ? (
            // Inventory item - use ValidatedForm
            <ValidatedForm
              method="post"
              action={path.to.issue}
              onSubmit={onClose}
              validator={issueValidator}
              defaultValues={{
                materialId: material?.id ?? "",
                jobOperationId: operationId,
                itemId: selectedItemId,
                quantity:
                  (material?.estimatedQuantity ?? 0) -
                  (material?.quantityIssued ?? 0),
                adjustmentType: "Negative Adjmt."
              }}
              fetcher={inventoryFetcher}
            >
              <ModalBody>
                <Hidden name="jobOperationId" />
                <Hidden name="materialId" />
                {material?.id && (
                  <Hidden name="adjustmentType" value="Negative Adjmt." />
                )}
                <div className="flex flex-col gap-4">
                  {showItemSelector && (
                    <div>
                      <label className="block text-sm font-medium mb-1">
                        Item
                      </label>
                      <ComboboxBase
                        placeholder="Select an item..."
                        value={selectedItemId}
                        onChange={(value) => {
                          handleItemChange(value);
                        }}
                        options={itemOptions}
                      />
                      <input
                        type="hidden"
                        name="itemId"
                        value={selectedItemId}
                      />
                    </div>
                  )}
                  {material?.id && (
                    <Hidden name="itemId" value={selectedItemId} />
                  )}

                  {isLoadingItem && (
                    <div className="text-sm text-muted-foreground">
                      Loading item details...
                    </div>
                  )}

                  {showContent && trackingType === "Inventory" && (
                    <>
                      {!material?.id && (
                        <div>
                          <label className="block text-sm font-medium mb-1">
                            Adjustment Type
                          </label>
                          <Select
                            name="adjustmentType"
                            defaultValue="Negative Adjmt."
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="Positive Adjmt.">
                                Add to Inventory
                              </SelectItem>
                              <SelectItem value="Negative Adjmt.">
                                Pull from Inventory
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                      <div>
                        <label className="block text-sm font-medium mb-1">
                          Quantity
                        </label>

                        <NumberField
                          value={quantity}
                          onChange={setQuantity}
                          minValue={0.01}
                        >
                          <NumberInputGroup className="relative">
                            <NumberInput name="quantity" />
                            <NumberInputStepper>
                              <NumberIncrementStepper>
                                <LuChevronUp size="1em" strokeWidth="3" />
                              </NumberIncrementStepper>
                              <NumberDecrementStepper>
                                <LuChevronDown size="1em" strokeWidth="3" />
                              </NumberDecrementStepper>
                            </NumberInputStepper>
                          </NumberInputGroup>
                        </NumberField>
                      </div>
                    </>
                  )}
                </div>
              </ModalBody>
              <ModalFooter>
                <Button variant="secondary" onClick={onClose}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  isLoading={inventoryFetcher.state !== "idle"}
                  isDisabled={
                    inventoryFetcher.state !== "idle" ||
                    !selectedItemId ||
                    isLoadingItem
                  }
                >
                  Issue
                </Button>
              </ModalFooter>
            </ValidatedForm>
          ) : (
            // Tracked items (Serial or Batch)
            <>
              <ModalBody>
                <div className="flex flex-col gap-4">
                  {showItemSelector && (
                    <div>
                      <label className="block text-sm font-medium mb-1">
                        Item
                      </label>
                      <ComboboxBase
                        placeholder="Select an item..."
                        value={selectedItemId}
                        onChange={handleItemChange}
                        options={itemOptions}
                      />
                    </div>
                  )}

                  {isLoadingItem && (
                    <div className="text-sm text-muted-foreground">
                      Loading item details...
                    </div>
                  )}

                  {showContent && trackingType === "Serial" && (
                    <Tabs value={activeTab} onValueChange={setActiveTab}>
                      <TabsList
                        className={cn(
                          "grid w-full grid-cols-2 mb-4",
                          hasTrackedInputs && "grid-cols-3"
                        )}
                      >
                        <TabsTrigger value="scan">
                          <LuQrCode className="mr-2" />
                          Scan
                        </TabsTrigger>
                        <TabsTrigger value="select">
                          <LuList className="mr-2" />
                          Select
                        </TabsTrigger>
                        {hasTrackedInputs && (
                          <TabsTrigger value="unconsume">
                            <LuUndo2 className="mr-2" />
                            Unconsume
                          </TabsTrigger>
                        )}
                      </TabsList>

                      <TabsContent value="scan">
                        <div className="flex flex-col gap-4">
                          {selectedSerialNumbers.map((sn, index) => (
                            <div
                              key={`${index}-serial-scan`}
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
                                        const newSerialNumbers = [
                                          ...selectedSerialNumbers
                                        ];
                                        newSerialNumbers[index] = {
                                          index,
                                          id: newValue
                                        };
                                        setSelectedSerialNumbers(
                                          newSerialNumbers
                                        );
                                      }}
                                      onBlur={(e) => {
                                        const newValue = e.target.value;
                                        const error = validateSerialNumber(
                                          newValue,
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
                                        if (!error) {
                                          updateSerialNumber({
                                            index,
                                            id: newValue
                                          });
                                        } else {
                                          const newSerialNumbers = [
                                            ...selectedSerialNumbers
                                          ];
                                          newSerialNumbers[index] = {
                                            index,
                                            id: ""
                                          };
                                          setSelectedSerialNumbers(
                                            newSerialNumbers
                                          );
                                        }
                                      }}
                                      className={cn(
                                        serialErrors[index] &&
                                          "border-destructive"
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
                                {index > 0 && (
                                  <IconButton
                                    aria-label="Remove Serial Number"
                                    icon={<LuX />}
                                    variant="ghost"
                                    onClick={() => removeSerialNumber(index)}
                                    className="flex-shrink-0"
                                  />
                                )}
                              </div>
                              {serialErrors[index] && (
                                <span className="text-xs text-destructive">
                                  {serialErrors[index]}
                                </span>
                              )}
                            </div>
                          ))}
                          <div>
                            <Button
                              type="button"
                              variant="secondary"
                              leftIcon={<LuCirclePlus />}
                              onClick={addSerialNumber}
                            >
                              Add
                            </Button>
                          </div>
                        </div>
                      </TabsContent>

                      <TabsContent value="select">
                        <div className="flex flex-col gap-4">
                          {selectedSerialNumbers.map((sn, index) => (
                            <div
                              key={`${index}-serial-select`}
                              className="flex flex-col gap-1"
                            >
                              <div className="flex items-center gap-2">
                                <div className="flex-1">
                                  <ComboboxBase
                                    placeholder={`Select Serial Number ${index + 1}`}
                                    value={sn.id}
                                    onChange={(value) => {
                                      const newSerialNumbers = [
                                        ...selectedSerialNumbers
                                      ];
                                      newSerialNumbers[index] = {
                                        index,
                                        id: value
                                      };
                                      setSelectedSerialNumbers(
                                        newSerialNumbers
                                      );
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
                                {index > 0 && (
                                  <IconButton
                                    aria-label="Remove Serial Number"
                                    icon={<LuX />}
                                    variant="ghost"
                                    onClick={() => removeSerialNumber(index)}
                                    className="flex-shrink-0"
                                  />
                                )}
                              </div>
                              {serialErrors[index] && (
                                <span className="text-xs text-destructive">
                                  {serialErrors[index]}
                                </span>
                              )}
                            </div>
                          ))}
                          <div>
                            <Button
                              type="button"
                              variant="secondary"
                              leftIcon={<LuCirclePlus />}
                              onClick={addSerialNumber}
                            >
                              Add
                            </Button>
                          </div>
                        </div>
                      </TabsContent>

                      {hasTrackedInputs && (
                        <TabsContent value="unconsume">
                          <div className="flex flex-col gap-4">
                            {trackedInputs.map((input) => (
                              <div
                                key={input.id}
                                className="flex items-center gap-3 p-2 border rounded-md"
                              >
                                <Checkbox
                                  id={`unconsume-${input.id}`}
                                  checked={selectedTrackedInputs.includes(
                                    input.id
                                  )}
                                  onCheckedChange={() =>
                                    toggleTrackedInput(input.id)
                                  }
                                />
                                <label
                                  htmlFor={`unconsume-${input.id}`}
                                  className="flex-1 cursor-pointer"
                                >
                                  <div className="font-medium text-sm">
                                    {input.id}
                                  </div>
                                  {input.readableId && (
                                    <div className="text-xs text-muted-foreground">
                                      Serial: {input.readableId}
                                    </div>
                                  )}
                                </label>
                              </div>
                            ))}
                            {trackedInputs.length === 0 && (
                              <Alert variant="warning">
                                <AlertTitle>No consumed materials</AlertTitle>
                                <AlertDescription>
                                  There are no consumed materials to unconsume.
                                </AlertDescription>
                              </Alert>
                            )}
                          </div>
                        </TabsContent>
                      )}
                    </Tabs>
                  )}

                  {showContent && trackingType === "Batch" && (
                    <Tabs value={activeTab} onValueChange={setActiveTab}>
                      <TabsList
                        className={cn(
                          "grid w-full grid-cols-2 mb-4",
                          hasTrackedInputs && "grid-cols-3"
                        )}
                      >
                        <TabsTrigger value="scan">
                          <LuQrCode className="mr-2" />
                          Scan
                        </TabsTrigger>
                        <TabsTrigger value="select">
                          <LuList className="mr-2" />
                          Select
                        </TabsTrigger>
                        {hasTrackedInputs && (
                          <TabsTrigger value="unconsume">
                            <LuUndo2 className="mr-2" />
                            Unconsume
                          </TabsTrigger>
                        )}
                      </TabsList>

                      <TabsContent value="scan">
                        <div className="flex flex-col gap-4">
                          {selectedBatchNumbers.map((batch, index) => (
                            <div key={index} className="flex flex-col gap-2">
                              <div className="flex items-center gap-2">
                                <div className="flex-1">
                                  <InputGroup>
                                    <Input
                                      value={batch.id}
                                      onChange={(e) => {
                                        const newValue = e.target.value;
                                        updateBatchNumber({
                                          ...batch,
                                          id: newValue
                                        });
                                      }}
                                      onBlur={(e) => {
                                        validateBatchInput(
                                          e.target.value,
                                          index
                                        );
                                      }}
                                      placeholder="Scan batch number"
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
                                <div className="w-24">
                                  <NumberField
                                    id={`quantity-${index}`}
                                    value={batch.quantity}
                                    onChange={(value) =>
                                      updateBatchNumber({
                                        ...batch,
                                        quantity: value
                                      })
                                    }
                                    minValue={0.01}
                                    maxValue={
                                      batchOptions.find(
                                        (o) => o.value === batch.id
                                      )?.availableQuantity ?? 999999
                                    }
                                  >
                                    <NumberInputGroup className="relative">
                                      <NumberInput />
                                      <NumberInputStepper>
                                        <NumberIncrementStepper>
                                          <LuChevronUp
                                            size="1em"
                                            strokeWidth="3"
                                          />
                                        </NumberIncrementStepper>
                                        <NumberDecrementStepper>
                                          <LuChevronDown
                                            size="1em"
                                            strokeWidth="3"
                                          />
                                        </NumberDecrementStepper>
                                      </NumberInputStepper>
                                    </NumberInputGroup>
                                  </NumberField>
                                </div>
                                {index > 0 && (
                                  <IconButton
                                    aria-label="Remove Batch Number"
                                    icon={<LuX />}
                                    variant="ghost"
                                    onClick={() => removeBatchNumber(index)}
                                  />
                                )}
                              </div>
                              {batchErrors[index] && (
                                <span className="text-xs text-destructive">
                                  {batchErrors[index]}
                                </span>
                              )}
                            </div>
                          ))}
                          <div>
                            <Button
                              type="button"
                              variant="secondary"
                              leftIcon={<LuCirclePlus />}
                              onClick={addBatchNumber}
                            >
                              Add
                            </Button>
                          </div>
                        </div>
                      </TabsContent>

                      <TabsContent value="select">
                        <div className="flex flex-col gap-4">
                          {selectedBatchNumbers.map((batch, index) => (
                            <div key={index} className="flex flex-col gap-2">
                              <div className="flex items-center gap-2">
                                <div className="flex-1">
                                  <ComboboxBase
                                    value={batch.id}
                                    onChange={(value) => {
                                      updateBatchNumber({
                                        ...batch,
                                        id: value
                                      });
                                      validateBatchInput(value, index);
                                    }}
                                    options={batchOptions}
                                    placeholder="Select batch number"
                                  />
                                </div>
                                <div className="w-24">
                                  <NumberField
                                    value={batch.quantity}
                                    onChange={(value) =>
                                      updateBatchNumber({
                                        ...batch,
                                        quantity: value
                                      })
                                    }
                                    minValue={0.01}
                                    maxValue={
                                      batchOptions.find(
                                        (o) => o.value === batch.id
                                      )?.availableQuantity ?? 999999
                                    }
                                  >
                                    <NumberInputGroup className="relative">
                                      <NumberInput />
                                      <NumberInputStepper>
                                        <NumberIncrementStepper>
                                          <LuChevronUp
                                            size="1em"
                                            strokeWidth="3"
                                          />
                                        </NumberIncrementStepper>
                                        <NumberDecrementStepper>
                                          <LuChevronDown
                                            size="1em"
                                            strokeWidth="3"
                                          />
                                        </NumberDecrementStepper>
                                      </NumberInputStepper>
                                    </NumberInputGroup>
                                  </NumberField>
                                </div>
                                {index > 0 && (
                                  <IconButton
                                    aria-label="Remove Batch Number"
                                    icon={<LuX />}
                                    variant="ghost"
                                    onClick={() => removeBatchNumber(index)}
                                  />
                                )}
                              </div>
                              {batchErrors[index] && (
                                <span className="text-xs text-destructive">
                                  {batchErrors[index]}
                                </span>
                              )}
                            </div>
                          ))}
                          <div>
                            <Button
                              type="button"
                              variant="secondary"
                              leftIcon={<LuCirclePlus />}
                              onClick={addBatchNumber}
                            >
                              Add Batch
                            </Button>
                          </div>
                        </div>
                      </TabsContent>

                      {hasTrackedInputs && (
                        <TabsContent value="unconsume">
                          <div className="flex flex-col gap-4">
                            <div className="flex gap-2">
                              <div className="flex-1">
                                <ComboboxBase
                                  value={unconsumedBatch}
                                  onChange={setUnconsumedBatch}
                                  options={unconsumeOptions}
                                  placeholder="Select batch to unconsume"
                                />
                              </div>
                              {unconsumedBatch && (
                                <div className="w-24">
                                  <Input
                                    isReadOnly
                                    value={
                                      trackedInputs
                                        .find(
                                          (input) =>
                                            input.id === unconsumedBatch
                                        )
                                        ?.quantity.toString() ?? "0"
                                    }
                                  />
                                </div>
                              )}
                            </div>
                            <div className="h-8" />
                          </div>
                        </TabsContent>
                      )}
                    </Tabs>
                  )}
                </div>
              </ModalBody>
              <ModalFooter>
                {splitEntitiesResult.length > 0 ? (
                  <Button variant="primary" onClick={onClose}>
                    Close
                  </Button>
                ) : (
                  <>
                    <Button variant="secondary" onClick={onClose}>
                      Cancel
                    </Button>
                    {activeTab === "unconsume" ? (
                      <Button
                        variant="destructive"
                        onClick={
                          trackingType === "Serial"
                            ? handleUnconsumeSerial
                            : handleUnconsumeBatch
                        }
                        isLoading={unconsumeFetcher.state !== "idle"}
                        isDisabled={
                          unconsumeFetcher.state !== "idle" ||
                          (trackingType === "Serial"
                            ? selectedTrackedInputs.length === 0
                            : !unconsumedBatch)
                        }
                      >
                        Unconsume
                      </Button>
                    ) : (
                      <Button
                        variant="primary"
                        onClick={
                          trackingType === "Serial"
                            ? handleSubmitSerial
                            : handleSubmitBatch
                        }
                        isLoading={fetcher.state !== "idle"}
                        isDisabled={
                          fetcher.state !== "idle" ||
                          !selectedItemId ||
                          isLoadingItem
                        }
                      >
                        Issue
                      </Button>
                    )}
                  </>
                )}
              </ModalFooter>
            </>
          )}

          {/* Footer for split entities result */}
          {splitEntitiesResult.length > 0 && (
            <ModalFooter>
              <Button variant="primary" onClick={onClose}>
                Close
              </Button>
            </ModalFooter>
          )}
        </ModalContent>
      </Modal>

      {/* Sub-modals for batch splitting */}
      {convertDisclosure.isOpen && (
        <ConvertSplitModal
          trackedEntity={trackedEntity}
          itemType={material?.itemType ?? "Part"}
          onCancel={() => {
            convertDisclosure.onClose();
            setTrackedEntity(null);
          }}
          onSuccess={(convertedEntity) => {
            setSplitEntitiesResult((prev) =>
              prev.map((entity) =>
                entity.newId === convertedEntity.trackedEntityId
                  ? {
                      ...entity,
                      readableId: convertedEntity.readableId,
                      quantity: convertedEntity.quantity
                    }
                  : entity
              )
            );
            convertDisclosure.onClose();
            setTrackedEntity(null);
          }}
        />
      )}
      {scrapDisclosure.isOpen && (
        <ScrapSplitModal
          materialId={material?.id!}
          parentTrackedEntityId={parentId ?? ""}
          trackedEntity={trackedEntity}
          onCancel={() => {
            scrapDisclosure.onClose();
            setTrackedEntity(null);
          }}
          onSuccess={() => {
            scrapDisclosure.onClose();
            setTrackedEntity(null);
            onClose();
          }}
        />
      )}
    </>
  );
}

// Sub-modal for converting split batch entities
function ConvertSplitModal({
  trackedEntity,
  itemType,
  onCancel,
  onSuccess
}: {
  trackedEntity: string | null;
  itemType: string | null;
  onCancel: () => void;
  onSuccess: (convertedEntity: {
    trackedEntityId: string;
    readableId: string;
    quantity: number;
  }) => void;
}) {
  const fetcher = useFetcher<{
    success: boolean;
    message: string;
    convertedEntity?: {
      trackedEntityId: string;
      readableId: string;
      quantity: number;
    };
  }>();

  useEffect(() => {
    if (fetcher.data?.success && fetcher.data.convertedEntity) {
      toast.success("Entity converted successfully");
      onSuccess(fetcher.data.convertedEntity);
    } else if (fetcher.data?.success === false) {
      toast.error(fetcher.data.message || "Failed to convert entity");
    }
  }, [fetcher.data, onSuccess]);

  if (!trackedEntity) return null;

  return (
    <Modal open onOpenChange={onCancel}>
      <ModalContent>
        <ModalHeader>
          <ModalTitle>
            Convert to New {itemType === "Material" ? "Size" : "Revision"}
          </ModalTitle>
          <ModalDescription>
            Convert this tracked entity into a quantity of 1 of a new size.
          </ModalDescription>
        </ModalHeader>
        <ValidatedForm
          method="post"
          action={path.to.convertEntity(trackedEntity)}
          defaultValues={{
            trackedEntityId: trackedEntity,
            newRevision: "",
            quantity: 1
          }}
          validator={convertEntityValidator}
          fetcher={fetcher}
        >
          <Hidden name="trackedEntityId" />
          <ModalBody>
            <div className="flex flex-col gap-4">
              <FormInput
                name="newRevision"
                label={`New ${itemType === "Material" ? "Size" : "Revision"}`}
                autoFocus
              />
              <FormNumberInput
                name="quantity"
                label="Quantity"
                minValue={0.001}
              />
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={onCancel}>
              Cancel
            </Button>
            <Button
              isLoading={fetcher.state !== "idle"}
              isDisabled={fetcher.state !== "idle"}
              type="submit"
              variant="primary"
            >
              Convert
            </Button>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
}

// Sub-modal for scrapping split batch entities
function ScrapSplitModal({
  materialId,
  parentTrackedEntityId,
  trackedEntity,
  onCancel,
  onSuccess
}: {
  materialId: string;
  parentTrackedEntityId: string;
  trackedEntity: string | null;
  onCancel: () => void;
  onSuccess: () => void;
}) {
  const fetcher = useFetcher<{ success: boolean; message: string }>();

  useEffect(() => {
    if (fetcher.data?.success) {
      onSuccess();
    }
  }, [fetcher.data?.success, onSuccess]);

  if (!trackedEntity) return null;

  return (
    <Modal open onOpenChange={onCancel}>
      <ModalContent>
        <ModalHeader>
          <ModalTitle>Are you sure you want to scrap this batch?</ModalTitle>
          <ModalDescription>
            The remaining quantity will be removed from inventory and issued to
            the job
          </ModalDescription>
        </ModalHeader>
        <ModalFooter>
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <fetcher.Form
            method="post"
            action={path.to.scrapEntity(
              materialId,
              trackedEntity,
              parentTrackedEntityId
            )}
          >
            <Button
              isLoading={fetcher.state !== "idle"}
              isDisabled={fetcher.state !== "idle"}
              type="submit"
              variant="destructive"
            >
              Scrap
            </Button>
          </fetcher.Form>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

// Hook for fetching serial numbers
function useSerialNumbers(itemId?: string) {
  const serialNumbersFetcher =
    useFetcher<Awaited<ReturnType<typeof getSerialNumbersForItem>>>();

  useEffect(() => {
    if (itemId) {
      serialNumbersFetcher.load(path.to.api.serialNumbers(itemId));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId]);

  return { data: serialNumbersFetcher.data };
}

// Hook for fetching batch numbers
function useBatchNumbers(itemId?: string) {
  const batchNumbersFetcher =
    useFetcher<Awaited<ReturnType<typeof getBatchNumbersForItem>>>();

  useEffect(() => {
    if (itemId) {
      batchNumbersFetcher.load(path.to.api.batchNumbers(itemId));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId]);

  return { data: batchNumbersFetcher.data };
}
