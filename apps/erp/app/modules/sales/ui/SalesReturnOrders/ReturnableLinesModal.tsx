import {
  Button,
  Checkbox,
  HStack,
  Input,
  InputGroup,
  InputLeftElement,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  NumberField,
  NumberInput,
  ScrollArea,
  toast,
  useDebounce,
  VStack
} from "@carbon/react";
import { INPUT_FORMAT, INPUT_STEP } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import { LuSearch } from "react-icons/lu";
import { useFetcher, useParams, useRevalidator } from "react-router";
import type { loader as returnableLinesLoader } from "~/routes/x+/sales-return-order+/returnable-lines";
import { path } from "~/utils/path";

// The static segment outranks the `$id` param, so this resolves to
// routes/x+/sales-return-order+/returnable-lines.tsx.
const returnableLinesUrl = path.to.salesReturnOrderReturnableLines;

const PAGE_SIZE = 5;

type ReturnableLine = Awaited<
  ReturnType<typeof returnableLinesLoader>
>["lines"][number];

// A selected line is snapshotted in full (not just its quantity) so it still
// submits after the search term changes and it scrolls out of the visible set.
type SelectedLine = {
  itemId: string;
  unitPrice: number;
  unitOfMeasureCode: string | null;
  salesOrderLineId: string | null;
  returnableQuantity: number;
  quantity: number;
};

type ReturnableLinesModalProps = {
  customerId: string;
  salesOrderId?: string | null;
  onClose: () => void;
};

const ReturnableLinesModal = ({
  customerId,
  salesOrderId,
  onClose
}: ReturnableLinesModalProps) => {
  const { t } = useLingui();
  const { id: orderId } = useParams();
  if (!orderId) throw new Error("Could not find orderId");

  const fetcher = useFetcher<typeof returnableLinesLoader>();
  const revalidator = useRevalidator();

  const [searchInput, setSearchInput] = useState("");
  // `search` is the committed (debounced) term that actually drives the query.
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(PAGE_SIZE);

  const commitSearch = useDebounce((value: string) => {
    setSearch(value);
    setLimit(PAGE_SIZE); // a new search resets paging; selections persist
  }, 400);

  // Re-query whenever the term or the page size changes. The list is replaced
  // (limit grows cumulatively) rather than appended, which keeps `selected`
  // — keyed by shipmentLineId — untouched across loads.
  // biome-ignore lint/correctness/useExhaustiveDependencies: fetcher is stable; re-run only on query inputs
  useEffect(() => {
    const params = new URLSearchParams({
      customerId,
      limit: String(limit)
    });
    if (salesOrderId) params.set("salesOrderId", salesOrderId);
    if (search.trim()) params.set("search", search.trim());
    fetcher.load(`${returnableLinesUrl}?${params.toString()}`);
  }, [customerId, salesOrderId, search, limit]);

  const lines = fetcher.data?.lines ?? [];
  const totalCount = fetcher.data?.totalCount ?? 0;
  const hasMore = totalCount > lines.length;

  const [selected, setSelected] = useState<Record<string, SelectedLine>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const selectedCount = Object.values(selected).filter(
    (line) => line.quantity > 0
  ).length;

  const toggle = (line: ReturnableLine) => {
    setSelected((prev) => {
      if (line.shipmentLineId in prev) {
        const { [line.shipmentLineId]: _removed, ...rest } = prev;
        return rest;
      }
      return {
        ...prev,
        [line.shipmentLineId]: {
          itemId: line.itemId,
          unitPrice: line.unitPrice,
          unitOfMeasureCode: line.unitOfMeasureCode,
          salesOrderLineId: line.salesOrderLineId,
          returnableQuantity: line.returnableQuantity,
          quantity: line.returnableQuantity
        }
      };
    });
  };

  const setQuantity = (shipmentLineId: string, value: number) => {
    setSelected((prev) => {
      const current = prev[shipmentLineId];
      if (!current) return prev;
      const clamped = Math.max(
        0,
        Math.min(Number.isFinite(value) ? value : 0, current.returnableQuantity)
      );
      return { ...prev, [shipmentLineId]: { ...current, quantity: clamped } };
    });
  };

  const onSubmit = async () => {
    // Submit ALL selected lines, not just the ones currently visible under the
    // active search — hence the full snapshot in `selected`.
    const rows = Object.entries(selected).filter(
      ([, line]) => line.quantity > 0
    );
    if (rows.length === 0) return;

    setIsSubmitting(true);
    try {
      let addedCount = 0;
      for (const [shipmentLineId, line] of rows) {
        const formData = new FormData();
        formData.append("salesReturnOrderId", orderId);
        formData.append("itemId", line.itemId);
        formData.append("quantity", String(line.quantity));
        formData.append("unitPrice", String(line.unitPrice));
        if (line.unitOfMeasureCode) {
          formData.append("unitOfMeasureCode", line.unitOfMeasureCode);
        }
        if (line.salesOrderLineId) {
          formData.append("salesOrderLineId", line.salesOrderLineId);
        }
        formData.append("shipmentLineId", shipmentLineId);

        const response = await fetch(path.to.newSalesReturnOrderLine(orderId), {
          method: "POST",
          body: formData
        });
        // The action redirects to the NEW line's URL on success; a failure
        // redirects back to the order's own /details (flash) or returns a
        // validation payload — neither is visible to response.ok alone.
        const landedOnNewLine = (() => {
          if (!response.redirected) return false;
          const segments = new URL(response.url).pathname
            .split("/")
            .filter(Boolean);
          const orderIndex = segments.indexOf(orderId);
          return (
            orderIndex >= 0 &&
            segments.length > orderIndex + 1 &&
            segments[orderIndex + 1] !== "details"
          );
        })();
        if (!landedOnNewLine) {
          throw new Error(
            t`Failed to add line — ${addedCount} of ${rows.length} lines were added`
          );
        }
        addedCount++;
      }
      toast.success(t`Added ${rows.length} lines`);
      revalidator.revalidate();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t`Failed to add lines`);
      revalidator.revalidate();
    } finally {
      setIsSubmitting(false);
    }
  };

  const isLoading = fetcher.state !== "idle";

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ModalContent size="xlarge">
        <ModalHeader>
          <ModalTitle>
            <Trans>Add lines from document</Trans>
          </ModalTitle>
          <ModalDescription>
            <Trans>
              Shipped lines for this customer with quantity remaining to return
            </Trans>
          </ModalDescription>
        </ModalHeader>
        <ModalBody>
          <VStack spacing={3} className="w-full">
            <InputGroup className="w-full">
              <InputLeftElement>
                <LuSearch className="text-muted-foreground w-3.5 h-3.5 mt-[-2px]" />
              </InputLeftElement>
              <Input
                value={searchInput}
                placeholder={t`Search by shipment, sales order, or item`}
                onChange={(e) => {
                  setSearchInput(e.target.value);
                  commitSearch(e.target.value);
                }}
              />
            </InputGroup>

            {isLoading && !fetcher.data ? (
              <p className="text-sm text-muted-foreground py-6 text-center w-full">
                <Trans>Loading returnable lines...</Trans>
              </p>
            ) : lines.length === 0 ? (
              <VStack spacing={1} className="py-6 items-center">
                <p className="text-sm text-muted-foreground text-center">
                  {search.trim() ? (
                    <Trans>No returnable lines match your search</Trans>
                  ) : (
                    <Trans>No returnable lines for this customer</Trans>
                  )}
                </p>
                <p className="text-xs text-muted-foreground text-center max-w-[42ch]">
                  <Trans>
                    Lines appear here once a sales order shipment has been
                    posted, and only for quantities not already authorized on
                    another RMA. Use Add Line Item for a blind return.
                  </Trans>
                </p>
              </VStack>
            ) : (
              <>
                <HStack className="w-full justify-between px-1">
                  <span className="text-xs text-muted-foreground">
                    {search.trim() ? (
                      t`${totalCount} results`
                    ) : hasMore ? (
                      <Trans>Most recent — search to find more</Trans>
                    ) : (
                      <Trans>All returnable lines</Trans>
                    )}
                  </span>
                  {selectedCount > 0 && (
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {t`${selectedCount} selected`}
                    </span>
                  )}
                </HStack>
                <ScrollArea className="max-h-[50dvh] w-full">
                  <VStack spacing={2} className="w-full">
                    {lines.map((line) => {
                      const isSelected = line.shipmentLineId in selected;
                      return (
                        <HStack
                          key={line.shipmentLineId}
                          className="w-full justify-between p-3 border rounded-lg"
                        >
                          <HStack spacing={3} className="min-w-0">
                            <Checkbox
                              isChecked={isSelected}
                              onCheckedChange={() => toggle(line)}
                            />
                            <VStack spacing={0} className="min-w-0 items-start">
                              <span className="text-sm font-medium truncate">
                                {line.itemReadableId}
                              </span>
                              <span className="text-xs text-muted-foreground truncate">
                                {line.itemName}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                {line.shipmentReadableId}
                                {line.salesOrderReadableId
                                  ? ` · ${line.salesOrderReadableId}`
                                  : ""}
                              </span>
                            </VStack>
                          </HStack>
                          <HStack spacing={4}>
                            <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                              {line.returnableQuantity}{" "}
                              <Trans>returnable</Trans>
                            </span>
                            {isSelected && (
                              <NumberField
                                formatOptions={INPUT_FORMAT.quantity}
                                step={INPUT_STEP.quantity}
                                value={selected[line.shipmentLineId]?.quantity}
                                onChange={(value) =>
                                  setQuantity(line.shipmentLineId, value)
                                }
                              >
                                <NumberInput
                                  className="min-w-[100px]"
                                  size="sm"
                                  min={0}
                                  max={line.returnableQuantity}
                                />
                              </NumberField>
                            )}
                          </HStack>
                        </HStack>
                      );
                    })}
                  </VStack>
                </ScrollArea>
                {hasMore && (
                  <Button
                    variant="secondary"
                    className="w-full"
                    isLoading={isLoading}
                    isDisabled={isLoading}
                    onClick={() => setLimit((current) => current + PAGE_SIZE)}
                  >
                    <Trans>Show more</Trans>
                  </Button>
                )}
              </>
            )}
          </VStack>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={onClose}>
            <Trans>Cancel</Trans>
          </Button>
          <Button
            isLoading={isSubmitting}
            isDisabled={isSubmitting || selectedCount === 0}
            onClick={onSubmit}
          >
            <Trans>Add Lines</Trans>
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

export default ReturnableLinesModal;
