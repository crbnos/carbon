import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Checkbox,
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
  ModalTitle,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
} from "@carbon/react";
import { useFetcher } from "@remix-run/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { JobMaterial, TrackedInput } from "~/services/types";
import { path } from "~/utils/path";

import type { TrackedEntityAttributes } from "@carbon/utils";
import { getItemReadableId } from "@carbon/utils";
import {
  LuCheck,
  LuCirclePlus,
  LuList,
  LuQrCode,
  LuUndo2,
  LuX,
} from "react-icons/lu";
import type { getSerialNumbersForItem } from "~/services/inventory.service";
import { useItems } from "~/stores";

export function SerialIssueModal({
  operationId,
  material,
  parentId,
  parentIdIsSerialized,
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
  const fetcher = useFetcher<{ success: boolean; message: string }>();
  const unconsumeFetcher = useFetcher<{ success: boolean; message: string }>();
  const { data: serialNumbers } = useSerialNumbers(material?.itemId ?? "");

  const [errors, setErrors] = useState<Record<number, string>>({});

  const options = useMemo(() => {
    return (
      serialNumbers?.data
        ?.filter((serialNumber) => serialNumber.status === "Available")
        .map((serialNumber) => {
          const attributes = serialNumber.attributes as TrackedEntityAttributes;
          return {
            label: serialNumber.id ?? "",
            value: serialNumber.id,
            helper: attributes["Serial Number"]
              ? `Serial ${attributes["Serial Number"]}`
              : attributes["Batch Number"]
              ? `Batch ${attributes["Batch Number"]}`
              : undefined,
          };
        }) ?? []
    );
  }, [serialNumbers]);

  const initialQuantity = parentIdIsSerialized
    ? material?.quantity ?? 1
    : material?.estimatedQuantity ?? 1;

  const [selectedSerialNumbers, setSelectedSerialNumbers] = useState<
    Array<{
      index: number;
      id: string;
    }>
  >(
    Array(initialQuantity)
      .fill("")
      .map((_, index) => ({ index, id: "" }))
  );

  const [selectedTrackedInputs, setSelectedTrackedInputs] = useState<string[]>(
    []
  );

  const validateSerialNumber = useCallback(
    (value: string, index: number) => {
      if (!value) return "Serial number is required";

      // Check for duplicates
      const isDuplicate = selectedSerialNumbers.some(
        (sn, i) => sn.id === value && i !== index
      );
      if (isDuplicate) return "Duplicate serial number";

      // Check if serial number exists in options
      const isValid = options.some((option) => option.value === value);
      if (!isValid) {
        const serialNumber = serialNumbers?.data?.find((sn) => sn.id === value);
        if (serialNumber) return `Serial number is ${serialNumber.status}`;
        return "Serial number is not available";
      }

      return null;
    },
    [selectedSerialNumbers, options, serialNumbers?.data]
  );

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

  const handleSubmit = useCallback(() => {
    // Validate all serial numbers
    let hasErrors = false;
    const newErrors: Record<number, string> = {};

    selectedSerialNumbers.forEach((sn) => {
      const error = validateSerialNumber(sn.id, sn.index);
      if (error) {
        newErrors[sn.index] = error;
        hasErrors = true;
      }
    });

    setErrors(newErrors);

    if (!hasErrors) {
      // Submit to the API
      const payload = {
        materialId: material?.id!,
        parentTrackedEntityId: parentId,
        children: selectedSerialNumbers.map((sn) => ({
          trackedEntityId: sn.id,
          quantity: 1,
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
    selectedSerialNumbers,
    validateSerialNumber,
    operationId,
    parentId,
    onClose,
    material?.id,
  ]);

  const handleUnconsume = useCallback(() => {
    if (selectedTrackedInputs.length === 0) {
      toast.error("Please select at least one item to unconsume");
      return;
    }

    const payload = {
      materialId: material?.id!,
      parentTrackedEntityId: parentId,
      children: selectedTrackedInputs.map((id) => ({
        trackedEntityId: id,
        quantity: 1,
      })),
    };

    unconsumeFetcher.submit(JSON.stringify(payload), {
      method: "post",
      action: path.to.unconsume,
      encType: "application/json",
    });
  }, [selectedTrackedInputs, material?.id, parentId, unconsumeFetcher]);

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

  const [activeTab, setActiveTab] = useState("scan");

  const toggleTrackedInput = useCallback((id: string) => {
    setSelectedTrackedInputs((prev) => {
      if (prev.includes(id)) {
        return prev.filter((item) => item !== id);
      } else {
        return [...prev, id];
      }
    });
  }, []);

  const [items] = useItems();

  return (
    <Modal open onOpenChange={onClose}>
      <ModalContent>
        <ModalTitle>
          {getItemReadableId(items, material?.itemId) ?? "Material"}
        </ModalTitle>
        <ModalDescription>{material?.description}</ModalDescription>
        <ModalBody>
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
                {selectedSerialNumbers.map((serialNumber, index) => (
                  <div
                    key={`${index}-serial-scan`}
                    className="flex flex-col gap-1"
                  >
                    <div className="flex items-center gap-2">
                      <div className="flex-1">
                        <InputGroup>
                          <Input
                            placeholder={`Serial Number ${index + 1}`}
                            value={serialNumber.id}
                            onChange={(e) => {
                              const newValue = e.target.value;
                              const newSerialNumbers = [
                                ...selectedSerialNumbers,
                              ];
                              newSerialNumbers[index] = {
                                index,
                                id: newValue,
                              };
                              setSelectedSerialNumbers(newSerialNumbers);
                            }}
                            onBlur={(e) => {
                              const newValue = e.target.value;
                              const error = validateSerialNumber(
                                newValue,
                                index
                              );

                              setErrors((prev) => {
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
                                  id: newValue,
                                });
                              } else {
                                // Clear the input value but keep the error message
                                const newSerialNumbers = [
                                  ...selectedSerialNumbers,
                                ];
                                newSerialNumbers[index] = {
                                  index,
                                  id: "",
                                };
                                setSelectedSerialNumbers(newSerialNumbers);
                              }
                            }}
                            className={cn(
                              errors[index] && "border-destructive"
                            )}
                          />
                          <InputRightElement className="pl-2">
                            {!errors[index] && serialNumber.id ? (
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
                    onClick={addSerialNumber}
                  >
                    Add
                  </Button>
                </div>
              </div>
            </TabsContent>
            <TabsContent value="select">
              <div className="flex flex-col gap-4">
                {selectedSerialNumbers.map((serialNumber, index) => (
                  <div
                    key={`${index}-serial-select`}
                    className="flex flex-col gap-1"
                  >
                    <div className="flex items-center gap-2">
                      <div className="flex-1">
                        <ComboboxBase
                          placeholder={`Select Serial Number ${index + 1}`}
                          value={serialNumber.id}
                          onChange={(value) => {
                            const newSerialNumbers = [...selectedSerialNumbers];
                            newSerialNumbers[index] = {
                              index,
                              id: value,
                            };
                            setSelectedSerialNumbers(newSerialNumbers);

                            // Validate on change for select
                            const error = validateSerialNumber(value, index);
                            setErrors((prev) => {
                              const newErrors = { ...prev };
                              if (error) {
                                newErrors[index] = error;
                              } else {
                                delete newErrors[index];
                              }
                              return newErrors;
                            });
                          }}
                          options={options}
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
                    onClick={addSerialNumber}
                  >
                    Add
                  </Button>
                </div>
              </div>
            </TabsContent>
            {trackedInputs.length > 0 && (
              <TabsContent value="unconsume">
                <div className="flex flex-col gap-4">
                  {trackedInputs.map((input) => {
                    const attributes =
                      input.attributes as TrackedEntityAttributes;
                    const serialNumber = attributes["Serial Number"];

                    return (
                      <div
                        key={input.id}
                        className="flex items-center gap-3 p-2 border rounded-md"
                      >
                        <Checkbox
                          id={`unconsume-${input.id}`}
                          checked={selectedTrackedInputs.includes(input.id)}
                          onCheckedChange={() => toggleTrackedInput(input.id)}
                        />
                        <label
                          htmlFor={`unconsume-${input.id}`}
                          className="flex-1 cursor-pointer"
                        >
                          <div className="font-medium text-sm">{input.id}</div>
                          {serialNumber && (
                            <div className="text-xs text-muted-foreground">
                              Serial: {serialNumber}
                            </div>
                          )}
                        </label>
                      </div>
                    );
                  })}

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
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          {activeTab === "unconsume" ? (
            <Button
              variant="destructive"
              onClick={handleUnconsume}
              isLoading={unconsumeFetcher.state !== "idle"}
              isDisabled={
                unconsumeFetcher.state !== "idle" ||
                selectedTrackedInputs.length === 0
              }
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
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

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
