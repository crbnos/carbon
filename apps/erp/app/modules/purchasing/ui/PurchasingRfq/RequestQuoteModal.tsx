// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useLoaderQuery } from "@carbon/query";
import {
  Button,
  Checkbox,
  Combobox,
  Input,
  Label,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  MultiSelect,
  NumberField,
  NumberInput,
  SHORTCUTS,
  Spinner,
  Table,
  Tabs,
  TabsList,
  TabsTrigger,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  VStack
} from "@carbon/react";
import { round } from "@carbon/utils";
import { plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useMemo, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { useSupplierApprovalRequired, useUser } from "~/hooks";
import { useQuantityFormatter } from "~/hooks/useQuantityFormatter";
import type { loader } from "~/routes/api+/purchasing.request-quote.$itemId";
import { useSuppliers } from "~/stores/suppliers";
import { path } from "~/utils/path";
import {
  groupRequestQuoteLines,
  type RequestQuoteLine
} from "../../purchasing.models";

type RequestQuoteModalProps = {
  itemId: string;
  open: boolean;
  onClose: () => void;
};

const ROW_HEIGHT = 56;

type RequestQuoteData = NonNullable<Awaited<ReturnType<typeof loader>>["data"]>;

// Mounted per open (keyed by the caller): the content size reads the loaded rows.
const RequestQuoteModal = ({
  itemId,
  open,
  onClose
}: RequestQuoteModalProps) => {
  const query = useLoaderQuery<typeof loader>(
    path.to.api.requestQuoteRows(itemId)
  );
  const data = query.data?.data;

  return (
    <Modal
      open={open}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ModalContent size={data && data.rows.length > 0 ? "xxlarge" : "medium"}>
        {data ? (
          <RequestQuoteForm data={data} onClose={onClose} />
        ) : (
          <>
            <ModalHeader>
              <ModalTitle>
                <Trans>Request Quote</Trans>
              </ModalTitle>
            </ModalHeader>
            <ModalBody>
              {query.data?.error ? (
                <p className="text-sm text-destructive">
                  {query.data.error.message}
                </p>
              ) : (
                <div className="flex justify-center py-8">
                  <Spinner />
                </div>
              )}
            </ModalBody>
          </>
        )}
      </ModalContent>
    </Modal>
  );
};

const RequestQuoteForm = ({
  data,
  onClose
}: {
  data: RequestQuoteData;
  onClose: () => void;
}) => {
  const { t } = useLingui();
  const formatQuantity = useQuantityFormatter();
  const { defaults } = useUser();
  const fetcher = useFetcher();
  const [allSuppliers] = useSuppliers();
  const approvalRequired = useSupplierApprovalRequired();

  const suppliers = useMemo(
    () =>
      allSuppliers
        .filter((s) => !approvalRequired || s.supplierStatus === "Active")
        .map((s) => ({ value: s.id, label: s.name ?? "" })),
    [allSuppliers, approvalRequired]
  );
  const usable = (supplierId: string | null) =>
    supplierId && suppliers.some((s) => s.value === supplierId)
      ? supplierId
      : "";

  const { item, rows } = data;
  const hasBom = rows.length > 0;
  // A bought part is usually quoted on its own; anything made, for its parts.
  const [pickedQuoteBom, setQuoteBom] = useState<boolean | null>(null);
  const quoteBom =
    pickedQuoteBom ?? (hasBom && item.replenishmentSystem !== "Buy");
  const [builds, setBuilds] = useState(1);
  const [itemQuantity, setItemQuantity] = useState(1);
  const [search, setSearch] = useState("");
  const [unticked, setUnticked] = useState<Set<string>>(new Set());
  const [chosen, setChosen] = useState<Record<string, string>>({});
  // Only the user's pick; until then the default, once the suppliers load.
  const [pickedItemSuppliers, setItemSuppliers] = useState<string[] | null>(
    null
  );
  const defaultItemSupplier = usable(item.defaultSupplierId);
  const itemSuppliers =
    pickedItemSuppliers ?? (defaultItemSupplier ? [defaultItemSupplier] : []);

  const supplierOf = (row: (typeof rows)[number]) =>
    chosen[row.itemId] ?? usable(row.defaultSupplierId);

  const visibleRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows.filter(
      (row) =>
        !term ||
        `${row.itemReadableId} ${row.description}`.toLowerCase().includes(term)
    );
  }, [rows, search]);

  // A Bill of Material can run to thousands of rows, each with a supplier picker.
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: visibleRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8
  });
  const virtualRows = virtualizer.getVirtualItems();
  const paddingTop = virtualRows[0]?.start ?? 0;
  const paddingBottom =
    virtualizer.getTotalSize() -
    (virtualRows[virtualRows.length - 1]?.end ?? 0);

  const ticked = rows.filter((row) => !unticked.has(row.itemId));
  const missingSupplier = ticked.filter((row) => !supplierOf(row)).length;

  const lines: RequestQuoteLine[] = quoteBom
    ? ticked
        .filter((row) => supplierOf(row))
        .map((row) => ({
          itemId: row.itemId,
          quantity: round(row.quantity * builds),
          supplierIds: [supplierOf(row)]
        }))
    : itemSuppliers.length > 0 && itemQuantity > 0
      ? [
          {
            itemId: item.id,
            quantity: itemQuantity,
            supplierIds: itemSuppliers
          }
        ]
      : [];
  const rfqCount = groupRequestQuoteLines(lines).length;

  const canCreate = lines.length > 0 && (!quoteBom || missingSupplier === 0);
  const isSubmitting = fetcher.state !== "idle";

  const submit = () => {
    if (!canCreate || isSubmitting) return;
    fetcher.submit(
      {
        ...(defaults?.locationId ? { locationId: defaults.locationId } : {}),
        lines
      },
      {
        method: "post",
        encType: "application/json",
        action: path.to.requestQuote
      }
    );
  };

  const setTicked = (itemId: string, isTicked: boolean) => {
    setUnticked((current) => {
      const next = new Set(current);
      if (isTicked) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  };

  return (
    <>
      <ModalHeader>
        <ModalTitle>
          <Trans>Request Quote</Trans>
        </ModalTitle>
        <ModalDescription>
          {item.readableId} · {item.name}
        </ModalDescription>
      </ModalHeader>
      <ModalBody>
        <VStack spacing={4}>
          {hasBom && (
            <div className="flex w-full flex-wrap items-end gap-4">
              <VStack spacing={1} className="w-auto">
                <Label>
                  <Trans>Quote for</Trans>
                </Label>
                <Tabs
                  value={quoteBom ? "bom" : "item"}
                  onValueChange={(value) => setQuoteBom(value === "bom")}
                >
                  <TabsList>
                    <TabsTrigger value="item">
                      <Trans>This part only</Trans>
                    </TabsTrigger>
                    <TabsTrigger value="bom">
                      <Trans>Bill of Material</Trans>
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
              </VStack>
              {quoteBom && (
                <>
                  <VStack spacing={1} className="w-24">
                    <Label htmlFor="request-quote-builds">
                      <Trans>Builds</Trans>
                    </Label>
                    <NumberField
                      id="request-quote-builds"
                      aria-label={t`Builds`}
                      minValue={1}
                      value={builds}
                      onChange={(value) => setBuilds(value || 1)}
                    >
                      <NumberInput />
                    </NumberField>
                  </VStack>
                  <VStack spacing={1} className="ml-auto w-56 max-md:w-full">
                    <Label htmlFor="request-quote-search">
                      <Trans>Find a part</Trans>
                    </Label>
                    <Input
                      id="request-quote-search"
                      type="search"
                      placeholder={t`Search`}
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </VStack>
                </>
              )}
            </div>
          )}

          {quoteBom ? (
            <div
              ref={scrollRef}
              className="max-h-[50dvh] w-full overflow-auto rounded-lg border border-border"
            >
              <Table>
                <Thead className="sticky top-0 z-10 bg-card">
                  <Tr>
                    <Th className="w-10">
                      <Checkbox
                        aria-label={t`Select all parts`}
                        isChecked={visibleRows.every(
                          (row) => !unticked.has(row.itemId)
                        )}
                        onCheckedChange={(checked) =>
                          setUnticked((current) => {
                            const next = new Set(current);
                            for (const row of visibleRows) {
                              if (checked === true) next.delete(row.itemId);
                              else next.add(row.itemId);
                            }
                            return next;
                          })
                        }
                      />
                    </Th>
                    <Th>
                      <Trans>Part</Trans>
                    </Th>
                    <Th>
                      <Trans>Used in</Trans>
                    </Th>
                    <Th className="text-right">
                      <Trans>Qty</Trans>
                    </Th>
                    <Th>
                      <Trans>Unit</Trans>
                    </Th>
                    <Th className="min-w-56">
                      <Trans>Supplier</Trans>
                    </Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {paddingTop > 0 && (
                    <tr style={{ height: paddingTop }} aria-hidden />
                  )}
                  {virtualRows.map((virtualRow) => {
                    const row = visibleRows[virtualRow.index];
                    if (!row) return null;
                    const isTicked = !unticked.has(row.itemId);
                    return (
                      <Tr key={row.itemId} style={{ height: ROW_HEIGHT }}>
                        <Td>
                          <Checkbox
                            aria-label={t`Include ${row.itemReadableId}`}
                            isChecked={isTicked}
                            onCheckedChange={(checked) =>
                              setTicked(row.itemId, checked === true)
                            }
                          />
                        </Td>
                        <Td>
                          <div className="flex flex-col">
                            <span className="font-mono text-xs">
                              {row.itemReadableId}
                            </span>
                            <span className="max-w-64 truncate text-xs text-muted-foreground">
                              {row.description}
                            </span>
                          </div>
                        </Td>
                        <Td
                          className="text-muted-foreground"
                          title={row.usedIn.join(", ")}
                        >
                          {row.usedIn.length > 1
                            ? t`${row.usedIn.length} places`
                            : row.usedIn[0]}
                        </Td>
                        <Td className="text-right tabular-nums">
                          {formatQuantity(round(row.quantity * builds))}
                        </Td>
                        <Td className="text-muted-foreground">
                          {row.unitOfMeasureCode}
                        </Td>
                        <Td>
                          <Combobox
                            size="sm"
                            aria-label={t`Supplier for ${row.itemReadableId}`}
                            placeholder={t`Choose supplier`}
                            options={suppliers}
                            value={supplierOf(row)}
                            isReadOnly={!isTicked}
                            onChange={(supplierId) =>
                              setChosen((current) => ({
                                ...current,
                                [row.itemId]: supplierId
                              }))
                            }
                          />
                        </Td>
                      </Tr>
                    );
                  })}
                  {paddingBottom > 0 && (
                    <tr style={{ height: paddingBottom }} aria-hidden />
                  )}
                </Tbody>
              </Table>
            </div>
          ) : (
            <>
              <VStack spacing={1}>
                <Label htmlFor="request-quote-quantity">
                  <Trans>Quantity</Trans>
                </Label>
                <NumberField
                  id="request-quote-quantity"
                  aria-label={t`Quantity`}
                  minValue={0}
                  value={itemQuantity}
                  onChange={setItemQuantity}
                >
                  <NumberInput />
                </NumberField>
              </VStack>
              <VStack spacing={1}>
                <Label>
                  <Trans>Suppliers</Trans>
                </Label>
                <MultiSelect
                  options={suppliers}
                  value={itemSuppliers}
                  placeholder={t`Choose suppliers`}
                  onChange={setItemSuppliers}
                />
              </VStack>
            </>
          )}
        </VStack>
      </ModalBody>
      <ModalFooter className="items-center">
        <p className="mr-auto text-sm text-muted-foreground">
          {quoteBom && missingSupplier > 0
            ? plural(missingSupplier, {
                one: "# ticked part needs a supplier. Choose one or untick it.",
                other:
                  "# ticked parts need a supplier. Choose one or untick them."
              })
            : lines.length === 0
              ? t`Choose at least one part and a supplier.`
              : t`Creates ${plural(rfqCount, {
                  one: "# draft RFQ",
                  other: "# draft RFQs"
                })}. Nothing goes to a supplier until you finalize.`}
        </p>
        <Button variant="secondary" onClick={onClose}>
          <Trans>Cancel</Trans>
        </Button>
        <Button
          isDisabled={!canCreate || isSubmitting}
          isLoading={isSubmitting}
          shortcut={SHORTCUTS.save}
          onClick={submit}
        >
          {rfqCount > 1 ? (
            <Trans>Create {rfqCount} RFQs</Trans>
          ) : (
            <Trans>Create RFQ</Trans>
          )}
        </Button>
      </ModalFooter>
    </>
  );
};

export default RequestQuoteModal;
