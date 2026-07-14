import { ValidatedForm } from "@carbon/form";
import {
  Button,
  Select as CarbonSelect,
  Combobox,
  HStack,
  Input,
  Modal,
  ModalBody,
  ModalClose,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { useFetcher } from "react-router";
import { z } from "zod";
import { useItems } from "~/stores/items";

const dummyValidator = z.object({});

export type MapExtractedLinesModalProps = {
  /** Base path that serves suggestions (GET) and accepts the confirm (POST). */
  endpoint: string;
  /** Party scoping appended to the GET query and POST body (e.g. customerId/supplierId). */
  party?: { field: string; id: string | undefined };
  title: ReactNode;
  /**
   * Renders the top of each line card — the document-specific summary
   * (part number vs description, quantity, price, ...). Receives the raw
   * mapping row. Should return the left summary block and any right-aligned
   * badges (rendered inside a `flex items-start justify-between` row).
   */
  renderSummary: (map: any) => ReactNode;
  onClose: () => void;
};

export default function MapExtractedLinesModal({
  endpoint,
  party,
  title,
  renderSummary,
  onClose
}: MapExtractedLinesModalProps) {
  const fetcher = useFetcher<any>();
  const [mappings, setMappings] = useState<any[]>([]);
  const [items] = useItems();

  const itemOptions = useMemo(
    () =>
      items
        .filter((item) => item.active)
        .map((item) => ({
          value: item.id,
          label: item.readableIdWithRevision,
          helper: item.name
        })),
    [items]
  );

  // Fetch suggestions
  useEffect(() => {
    if (fetcher.state === "idle" && !fetcher.data) {
      fetcher.load(
        `${endpoint}${party?.id ? `?${party.field}=${party.id}` : ""}`
      );
    }
  }, [endpoint, party?.field, party?.id, fetcher]);

  useEffect(() => {
    if (fetcher.data?.data && mappings.length === 0) {
      const initialMappings = fetcher.data.data.map((item: any) => ({
        ...item,
        itemId: item.itemId || item.suggestedItemId
      }));
      setMappings(initialMappings);
    }
  }, [fetcher.data, mappings.length]);

  const handleActionChange = (lineId: string, action: string) => {
    setMappings((prev) =>
      prev.map((m) => (m.lineId === lineId ? { ...m, action } : m))
    );
  };

  const handleItemSelect = (lineId: string, itemId: string) => {
    setMappings((prev) =>
      prev.map((m) => (m.lineId === lineId ? { ...m, itemId } : m))
    );
  };

  const handleCreateNameChange = (lineId: string, createName: string) => {
    setMappings((prev) =>
      prev.map((m) => (m.lineId === lineId ? { ...m, createName } : m))
    );
  };

  const handleSubmit = () => {
    const formData = new FormData();
    if (party?.id) formData.append(party.field, party.id);
    formData.append("mappings", JSON.stringify(mappings));

    fetcher.submit(formData, { method: "post", action: endpoint });
  };

  useEffect(() => {
    if (fetcher.data?.success) {
      onClose();
    }
  }, [fetcher.data, onClose]);

  const isLoading = fetcher.state !== "idle";

  const isEmpty = mappings.length === 0 && !isLoading;

  return (
    <Modal open={true} onOpenChange={(val) => !val && onClose()}>
      <ModalOverlay />
      <ModalContent size="xlarge">
        <ValidatedForm validator={dummyValidator} onSubmit={handleSubmit}>
          <ModalHeader>
            {title}
            <ModalClose />
          </ModalHeader>
          <ModalBody className="max-h-[70vh] overflow-y-auto">
            <div className="mb-6 space-y-1">
              <p className="max-w-[70ch] text-pretty text-sm text-muted-foreground">
                <Trans>
                  Some lines extracted from the PDF could not be automatically
                  mapped to your inventory items. Review and map each line
                  below.
                </Trans>
              </p>
              {mappings.length > 0 && (
                <p className="text-xs text-muted-foreground tabular-nums">
                  <Trans>{mappings.length} lines to map</Trans>
                </p>
              )}
            </div>

            <div className="space-y-2">
              {mappings.length === 0 &&
                isLoading &&
                [0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className="rounded-lg border border-border bg-card p-4"
                  >
                    <div className="h-4 w-40 animate-pulse rounded bg-muted" />
                    <div className="mt-2 h-3 w-64 animate-pulse rounded bg-muted" />
                    <div className="mt-4 h-9 w-full animate-pulse rounded bg-muted" />
                  </div>
                ))}

              {isEmpty && (
                <div className="rounded-lg border border-dashed border-border py-12 text-center">
                  <p className="text-sm text-muted-foreground">
                    <Trans>No lines to map</Trans>
                  </p>
                </div>
              )}

              {mappings.map((map) => (
                <div
                  key={map.lineId}
                  className="rounded-lg border border-border bg-card transition-colors hover:border-foreground/20"
                >
                  <div className="flex items-start justify-between gap-4 px-4 py-3">
                    {renderSummary(map)}
                  </div>

                  <div className="grid grid-cols-1 gap-3 border-t border-border px-4 py-3 sm:grid-cols-[minmax(0,200px)_1fr] sm:items-center">
                    <CarbonSelect
                      value={map.action}
                      onValueChange={(val) =>
                        handleActionChange(map.lineId, val)
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="map">
                          Select existing item
                        </SelectItem>
                        <SelectItem value="create">Create new item</SelectItem>
                        <SelectItem value="ignore">Leave unmapped</SelectItem>
                      </SelectContent>
                    </CarbonSelect>

                    <div className="min-w-0">
                      {map.action === "map" && (
                        <>
                          <Combobox
                            options={itemOptions}
                            value={map.itemId}
                            onChange={(val) =>
                              handleItemSelect(map.lineId, val)
                            }
                            placeholder="Select item"
                            isClearable
                          />
                          <input
                            type="hidden"
                            name={`item-${map.lineId}`}
                            value={map.itemId ?? ""}
                          />
                        </>
                      )}
                      {map.action === "create" && (
                        <Input
                          placeholder="New item name"
                          value={
                            map.createName ??
                            map.customerPartId ??
                            map.description ??
                            ""
                          }
                          onChange={(e) =>
                            handleCreateNameChange(map.lineId, e.target.value)
                          }
                        />
                      )}
                      {map.action === "ignore" && (
                        <p className="text-sm text-muted-foreground">
                          <Trans>Will remain as a comment line</Trans>
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </ModalBody>
          <ModalFooter>
            <HStack spacing={2} className="w-full justify-end">
              <ModalClose asChild>
                <Button variant="secondary" onClick={onClose}>
                  <Trans>Cancel</Trans>
                </Button>
              </ModalClose>
              <Button type="submit" isLoading={isLoading}>
                <Trans>Confirm Mapping</Trans>
              </Button>
            </HStack>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
}
