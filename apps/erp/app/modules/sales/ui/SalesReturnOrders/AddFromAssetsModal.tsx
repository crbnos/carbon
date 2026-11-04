// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

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
  ScrollArea,
  useDebounce,
  VStack
} from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import { LuSearch } from "react-icons/lu";
import { useFetcher, useParams } from "react-router";
import { WarrantyBadge } from "~/modules/service/ui/ServiceStatus";
import type { loader as fromAssetsLoader } from "~/routes/x+/sales-return-order+/$id.from-assets";
import { path } from "~/utils/path";

const PAGE_SIZE = 5;

type AddFromAssetsModalProps = {
  onClose: () => void;
};

/**
 * "Add from assets": the RMA customer's units, searched by serial. Each
 * chosen asset becomes one line of one unit, with the return type its
 * warranty suggests (`createReturnOrderLinesFromAssets`).
 */
const AddFromAssetsModal = ({ onClose }: AddFromAssetsModalProps) => {
  const { t } = useLingui();
  const { id: orderId } = useParams();
  if (!orderId) throw new Error("Could not find orderId");

  const assetsFetcher = useFetcher<typeof fromAssetsLoader>();
  const submitFetcher = useFetcher();

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(PAGE_SIZE);

  const commitSearch = useDebounce((value: string) => {
    setSearch(value);
    setLimit(PAGE_SIZE);
  }, 400);

  // biome-ignore lint/correctness/useExhaustiveDependencies: fetcher is stable; re-run only on query inputs
  useEffect(() => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (search.trim()) params.set("search", search.trim());
    assetsFetcher.load(
      `${path.to.salesReturnOrderFromAssets(orderId)}?${params.toString()}`
    );
  }, [orderId, search, limit]);

  const assets = assetsFetcher.data?.assets ?? [];
  const count = assetsFetcher.data?.count ?? 0;
  const onReturn = new Set(assetsFetcher.data?.onReturn ?? []);
  const hasMore = count > assets.length;
  const isLoading = assetsFetcher.state !== "idle";

  // Selections persist across searches, keyed by asset id.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const toggle = (assetId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(assetId)) next.delete(assetId);
      else next.add(assetId);
      return next;
    });
  };

  const [submitted, setSubmitted] = useState(false);
  const isSubmitting = submitFetcher.state !== "idle";
  useEffect(() => {
    if (submitted && submitFetcher.state === "idle") onClose();
  }, [submitted, submitFetcher.state, onClose]);

  const onSubmit = () => {
    if (selected.size === 0) return;
    const formData = new FormData();
    for (const assetId of selected) {
      formData.append("customerAssetIds", assetId);
    }
    setSubmitted(true);
    submitFetcher.submit(formData, {
      method: "post",
      action: path.to.salesReturnOrderFromAssets(orderId)
    });
  };

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
            <Trans>Add lines from assets</Trans>
          </ModalTitle>
          <ModalDescription>
            <Trans>
              Each asset becomes one line for one unit. A unit under warranty is
              a Return for Warranty, any other a Return for Service.
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
                placeholder={t`Search by serial`}
                onChange={(e) => {
                  setSearchInput(e.target.value);
                  commitSearch(e.target.value);
                }}
              />
            </InputGroup>

            {isLoading && !assetsFetcher.data ? (
              <p className="text-sm text-muted-foreground py-6 text-center w-full">
                <Trans>Loading assets...</Trans>
              </p>
            ) : assets.length === 0 ? (
              <VStack spacing={1} className="py-6 items-center">
                <p className="text-sm text-muted-foreground text-center">
                  {search.trim() ? (
                    <Trans>No assets match your search</Trans>
                  ) : (
                    <Trans>This customer has no assets</Trans>
                  )}
                </p>
                <p className="text-xs text-muted-foreground text-center max-w-[42ch]">
                  <Trans>
                    A serialized unit becomes a customer asset when its shipment
                    posts. Register older units under Service → Customer Assets.
                  </Trans>
                </p>
              </VStack>
            ) : (
              <>
                <HStack className="w-full justify-between px-1">
                  <span className="text-xs text-muted-foreground">
                    {search.trim() ? (
                      t`${count} results`
                    ) : hasMore ? (
                      <Trans>Most recent — search to find more</Trans>
                    ) : (
                      <Trans>All assets</Trans>
                    )}
                  </span>
                  {selected.size > 0 && (
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {t`${selected.size} selected`}
                    </span>
                  )}
                </HStack>
                <ScrollArea className="max-h-[50dvh] w-full">
                  <VStack spacing={2} className="w-full">
                    {assets.map((asset) => {
                      const isOnReturn = onReturn.has(asset.id);
                      const shippedOn = formatDate(asset.shippedDate);
                      return (
                        <HStack
                          key={asset.id}
                          className="w-full justify-between p-3 border rounded-lg"
                        >
                          <HStack spacing={3} className="min-w-0 flex-1">
                            <Checkbox
                              isChecked={selected.has(asset.id)}
                              disabled={isOnReturn}
                              onCheckedChange={() => toggle(asset.id)}
                            />
                            <VStack
                              spacing={0}
                              className="min-w-0 flex-1 items-start"
                            >
                              <span className="text-sm font-medium truncate w-full whitespace-nowrap">
                                {asset.trackedEntity?.readableId}
                              </span>
                              <span className="text-xs text-muted-foreground truncate w-full">
                                {asset.item?.readableIdWithRevision}
                                {shippedOn
                                  ? ` · ${t`Shipped ${shippedOn}`}`
                                  : ""}
                              </span>
                            </VStack>
                          </HStack>
                          <HStack spacing={2} className="shrink-0">
                            {isOnReturn && (
                              <span className="text-xs text-muted-foreground whitespace-nowrap">
                                <Trans>On this RMA</Trans>
                              </span>
                            )}
                            <WarrantyBadge asset={asset} />
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
            isDisabled={isSubmitting || selected.size === 0}
            onClick={onSubmit}
          >
            <Trans>Add Lines</Trans>
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

export default AddFromAssetsModal;
