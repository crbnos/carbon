import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  cn,
  Combobox as ComboboxBase,
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
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
  useDisclosure,
} from "@carbon/react";

import { useFetcher } from "@remix-run/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { JobMaterial, TrackedInput } from "~/services/types";
import { path } from "~/utils/path";

import {
  Input as FormInput,
  Number as FormNumberInput,
  Hidden,
  ValidatedForm,
} from "@carbon/form";
import type { TrackedEntityAttributes } from "@carbon/utils";
import { getItemReadableId } from "@carbon/utils";
import { useNumberFormatter } from "@react-aria/i18n";
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
  LuX,
} from "react-icons/lu";
import type { getBatchNumbersForItem } from "~/services/inventory.service";
import { convertEntityValidator } from "~/services/models";
import { useItems } from "~/stores";

export function BatchIssueModal({
  parentId,
  parentIdIsSerialized,
  operationId,
  material,
  trackedInputs,
  onClose,
}: {
  parentId: string;
  parentIdIsSerialized: boolean;
  operationId: string;
  material?: JobMaterial;
  trackedInputs: TrackedInput[];
  onClose: () => void;
}) {
  const { data: batchNumbers } = useBatchNumbers(material?.itemId ?? "");

  const [errors, setErrors] = useState<Record<number, string>>({});

  const options = useMemo(() => {
    return (
      batchNumbers?.data
        ?.filter((batchNumber) => batchNumber.status === "Available")
        .map((batchNumber) => {
          const attributes = batchNumber.attributes as TrackedEntityAttributes;
          return {
            label: batchNumber.sourceDocumentReadableId ?? "",
            value: batchNumber.id,
            helper: attributes["Batch Number"]
              ? `${batchNumber.id.slice(0, 10)} - ${
                  batchNumber.quantity
                } Available ${
                  attributes["Batch Number"]
                    ? `of Batch ${attributes["Batch Number"]}`
                    : undefined
                }`
              : `${batchNumber.id.slice(0, 10)} - ${
                  batchNumber.quantity
                } Available`,
            availableQuantity: batchNumber.quantity,
          };
        }) ?? []
    );
  }, [batchNumbers]);

  const unconsumeOptions = useMemo(() => {
    return trackedInputs.map((input) => ({
      label: input.id,
      value: input.id,
      helper: `${input.quantity} ${
        (input.attributes as TrackedEntityAttributes)?.["Batch Number"]
          ? `of Batch ${
              (input.attributes as TrackedEntityAttributes)?.["Batch Number"]
            }`
          : ""
      }`,
    }));
  }, [trackedInputs]);

  const initialQuantity = parentIdIsSerialized
    ? material?.quantity ?? 1
    : material?.estimatedQuantity ?? 1;

  const [selectedBatchNumbers, setSelectedBatchNumbers] = useState<
    Array<{
      index: number;
      id: string;
      quantity: number;
    }>
  >(
    Array(1)
      .fill("")
      .map((_, index) => ({ index, id: "", quantity: initialQuantity }))
  );

  const validateBatchNumber = useCallback(
    (value: string, quantity: number, index: number) => {
      if (!value) return "Batch number is required";

      // Check for duplicates
      const isDuplicate = selectedBatchNumbers.some(
        (bn, i) => bn.id === value && i !== index
      );
      if (isDuplicate) return "Duplicate batch number";

      // Check if batch number exists in options
      const batchOption = options.find((option) => option.value === value);
      if (!batchOption) {
        const batchNumber = batchNumbers?.data?.find((bn) => bn.id === value);
        if (batchNumber) return `Batch number is ${batchNumber.status}`;
        return "Batch number is not available";
      }

      // Check if quantity is valid
      if (quantity <= 0) return "Quantity must be greater than 0";
      if (quantity > batchOption.availableQuantity)
        return `Quantity cannot exceed available quantity (${batchOption.availableQuantity})`;

      return null;
    },
    [selectedBatchNumbers, options, batchNumbers?.data]
  );

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
      // Remove the item at the specified index
      const filtered = prev.filter((_, i) => i !== indexToRemove);

      // Reindex the remaining items
      return filtered.map((item, i) => ({ ...item, index: i }));
    });

    // Clean up any errors for the removed index
    setErrors((prev) => {
      const newErrors = { ...prev };
      delete newErrors[indexToRemove];

      // Reindex the errors for indices greater than the removed one
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

  const handleSubmit = useCallback(() => {
    // Validate all batch numbers
    let hasErrors = false;
    const newErrors: Record<number, string> = {};

    selectedBatchNumbers.forEach((bn) => {
      const error = validateBatchNumber(bn.id, bn.quantity, bn.index);
      if (error) {
        newErrors[bn.index] = error;
        hasErrors = true;
      }
    });

    setErrors(newErrors);

    if (!hasErrors) {
      // Submit to the API
      const payload = {
        materialId: material?.id!,
        parentTrackedEntityId: parentId,
        children: selectedBatchNumbers.map((bn) => ({
          trackedEntityId: bn.id,
          quantity: bn.quantity,
        })),
      };

      fetcher.submit(JSON.stringify(payload), {
        method: "post",
        action: path.to.issueTrackedEntity,
        encType: "application/json",
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    selectedBatchNumbers,
    validateBatchNumber,
    operationId,
    parentId,
    onClose,
    material?.id,
  ]);

  const [splitEntitiesResult, setSplitEntitiesResult] = useState<
    {
      newId: string;
      originalId: string;
      quantity: number;
      readableId?: string;
    }[]
  >([]);

  const processedFetcherData = useRef<typeof fetcher.data | null>(null);

  useEffect(() => {
    // Only process if we have new data that we haven't processed yet
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
          // Map the split entities to our state format (use newId as the id)
          setSplitEntitiesResult(
            fetcher.data.splitEntities.map((entity) => ({
              newId: entity.newId,
              originalId: entity.originalId,
              readableId: entity.readableId,
              quantity: entity.quantity,
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

  const validateBatchInput = useCallback(
    (value: string, index: number) => {
      if (!value) {
        setErrors((prev) => ({ ...prev, [index]: "Batch number is required" }));
        return false;
      }

      // Check for duplicates by comparing with all other batch numbers
      // This ensures we catch duplicates even after adding new batch numbers
      const duplicateIndices = selectedBatchNumbers
        .map((bn, i) => (bn.id === value && i !== index ? i : -1))
        .filter((i) => i !== -1);

      if (duplicateIndices.length > 0) {
        setErrors((prev) => ({ ...prev, [index]: "Duplicate batch number" }));
        return false;
      }

      // Check if batch number exists in options
      const batchOption = options.find((option) => option.value === value);
      if (!batchOption) {
        setErrors((prev) => ({
          ...prev,
          [index]: "Batch number is not available",
        }));
        return false;
      }

      // Check if the requested quantity exceeds available quantity
      const currentBatchNumber = selectedBatchNumbers[index];
      if (currentBatchNumber.quantity > batchOption.availableQuantity) {
        // If we need more than available, create a new batch row with remaining quantity
        const remainingQuantity =
          currentBatchNumber.quantity - batchOption.availableQuantity;

        // Update current row to use maximum available quantity
        updateBatchNumber({
          ...currentBatchNumber,
          id: value,
          quantity: batchOption.availableQuantity,
        });

        // Add a new row for the remaining quantity
        setSelectedBatchNumbers((prev) => {
          const newIndex = prev.length;
          return [
            ...prev,
            { index: newIndex, id: "", quantity: remainingQuantity },
          ];
        });
      }

      // Clear errors if valid
      setErrors((prev) => {
        const newErrors = { ...prev };
        delete newErrors[index];
        return newErrors;
      });
      return true;
    },
    [selectedBatchNumbers, options, updateBatchNumber]
  );

  const [activeTab, setActiveTab] = useState("scan");

  const [unconsumedBatch, setUnconsumedBatch] = useState("");
  const handleUnconsume = useCallback(() => {
    const payload = {
      materialId: material?.id!,
      parentTrackedEntityId: parentId,
      children: [
        {
          trackedEntityId: unconsumedBatch,
          quantity:
            trackedInputs.find((input) => input.id === unconsumedBatch)
              ?.quantity ?? 0,
        },
      ],
    };

    fetcher.submit(JSON.stringify(payload), {
      method: "post",
      action: path.to.unconsume,
      encType: "application/json",
    });
    // fetcher is not needed to be in the dependency array
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unconsumedBatch, material?.id, parentId, trackedInputs]);

  const [items] = useItems();
  const numberFormatter = useNumberFormatter({
    maximumFractionDigits: 4,
  });

  const convertDisclosure = useDisclosure();
  const scrapDisclosure = useDisclosure();
  const [trackedEntity, setTrackedEntity] = useState<string | null>(null);

  return (
    <>
      <Modal open onOpenChange={onClose}>
        <ModalContent>
          <ModalHeader>
            <ModalTitle>{material?.description}</ModalTitle>
          </ModalHeader>
          <ModalBody>
            {splitEntitiesResult.length > 0 ? (
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
            ) : (
              <Tabs value={activeTab} onValueChange={setActiveTab}>
                <TabsList
                  className={cn(
                    "grid w-full grid-cols-2 mb-4",
                    trackedInputs.length > 0 && "grid-cols-3"
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
                  {trackedInputs.length > 0 && (
                    <TabsTrigger value="unconsume">
                      <LuUndo2 className="mr-2" />
                      Unconsume
                    </TabsTrigger>
                  )}
                </TabsList>
                <TabsContent value="scan">
                  <div className="flex flex-col gap-4">
                    {selectedBatchNumbers.map((batchNumber, index) => (
                      <div key={index} className="flex flex-col gap-2">
                        <div className="flex items-center gap-2">
                          <div className="flex-1">
                            <InputGroup>
                              <Input
                                value={batchNumber.id}
                                onChange={(e) => {
                                  const newValue = e.target.value;
                                  updateBatchNumber({
                                    ...batchNumber,
                                    id: newValue,
                                  });
                                }}
                                onBlur={(e) => {
                                  validateBatchInput(e.target.value, index);
                                }}
                                placeholder="Scan batch number"
                              />
                              <InputRightElement className="pl-2">
                                {!errors[index] && batchNumber.id ? (
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
                              value={batchNumber.quantity}
                              onChange={(value) =>
                                updateBatchNumber({
                                  ...batchNumber,
                                  quantity: value,
                                })
                              }
                              minValue={0.01}
                              maxValue={
                                options.find((o) => o.value === batchNumber.id)
                                  ?.availableQuantity ?? 999999
                              }
                            >
                              <NumberInputGroup className="relative">
                                <NumberInput />
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
                          {index > 0 && (
                            <IconButton
                              aria-label="Remove Batch Number"
                              icon={<LuX />}
                              variant="ghost"
                              onClick={() => removeBatchNumber(index)}
                            />
                          )}
                        </div>
                        {errors[index] && (
                          <span className="text-xs text-destructive">
                            {errors[index]}
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
                    {selectedBatchNumbers.map((batchNumber, index) => (
                      <div key={index} className="flex flex-col gap-2">
                        <div className="flex items-center gap-2">
                          <div className="flex-1">
                            <ComboboxBase
                              value={batchNumber.id}
                              onChange={(value) => {
                                updateBatchNumber({
                                  ...batchNumber,
                                  id: value,
                                });
                                validateBatchInput(value, index);
                              }}
                              options={options}
                              placeholder="Select batch number"
                            />
                          </div>
                          <div className="w-24">
                            <NumberField
                              value={batchNumber.quantity}
                              onChange={(value) =>
                                updateBatchNumber({
                                  ...batchNumber,
                                  quantity: value,
                                })
                              }
                              minValue={0.01}
                              maxValue={
                                options.find((o) => o.value === batchNumber.id)
                                  ?.availableQuantity ?? 999999
                              }
                            >
                              <NumberInputGroup className="relative">
                                <NumberInput />
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
                          {index > 0 && (
                            <IconButton
                              aria-label="Remove Batch Number"
                              icon={<LuX />}
                              variant="ghost"
                              onClick={() => removeBatchNumber(index)}
                            />
                          )}
                        </div>
                        {errors[index] && (
                          <span className="text-xs text-destructive">
                            {errors[index]}
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
                {trackedInputs.length > 0 && (
                  <TabsContent value="unconsume">
                    <div className="flex flex-col gap-4">
                      <div className="flex gap-2">
                        <div className="flex-1">
                          <ComboboxBase
                            value={unconsumedBatch}
                            onChange={(value) => {
                              setUnconsumedBatch(value);
                            }}
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
                                  .find((input) => input.id === unconsumedBatch)
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
                    onClick={handleUnconsume}
                    isLoading={fetcher.state !== "idle"}
                    isDisabled={fetcher.state !== "idle" || !unconsumedBatch}
                  >
                    Unconsume
                  </Button>
                ) : (
                  <Button
                    variant="primary"
                    onClick={handleSubmit}
                    isLoading={fetcher.state !== "idle"}
                    isDisabled={fetcher.state !== "idle"}
                  >
                    Issue
                  </Button>
                )}
              </>
            )}
          </ModalFooter>
        </ModalContent>
      </Modal>
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
                      quantity: convertedEntity.quantity,
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
          parentTrackedEntityId={parentId}
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

function ConvertSplitModal({
  trackedEntity,
  itemType,
  onCancel,
  onSuccess,
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
            quantity: 1,
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

function ScrapSplitModal({
  materialId,
  parentTrackedEntityId,
  trackedEntity,
  onCancel,
  onSuccess,
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
