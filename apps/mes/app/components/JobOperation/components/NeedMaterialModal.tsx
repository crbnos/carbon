// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Result } from "@carbon/auth";
import {
  Hidden,
  Submit,
  TextArea,
  useField,
  ValidatedForm
} from "@carbon/form";
import { useAction, useLoaderQuery } from "@carbon/query";
import {
  Badge,
  Button,
  cn,
  HStack,
  Input,
  InputGroup,
  InputLeftElement,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  Spinner,
  toast,
  useDebounce,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { useState } from "react";
import { LuCheck, LuMessageSquarePlus, LuSearch } from "react-icons/lu";
import ItemThumbnail from "~/components/ItemThumbnail";
import type { loader as catalogLoader } from "~/routes/api+/material-request.catalog";
import type { loader as jobItemsLoader } from "~/routes/api+/material-request.job-items";
import type { RequestableItem } from "~/services/material-request.service";
import { materialRequestValidator } from "~/services/models";
import { path } from "~/utils/path";

export function NeedMaterialModal({
  operationId,
  isOpen,
  onClose
}: {
  operationId: string;
  isOpen: boolean;
  onClose: () => void;
}) {
  return (
    <Modal
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ModalContent>
        <NeedMaterialBody operationId={operationId} onClose={onClose} />
      </ModalContent>
    </Modal>
  );
}

function NeedMaterialBody({
  operationId,
  onClose
}: {
  operationId: string;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const fetcher = useAction<Result>({
    onSuccess: (data) => {
      if (data?.success) {
        toast.success(t`Material requested`);
        onClose();
      }
    }
  });

  return (
    <ValidatedForm
      method="post"
      action={path.to.materialRequestNew}
      validator={materialRequestValidator}
      defaultValues={{ jobOperationId: operationId, itemId: "", note: "" }}
      fetcher={fetcher}
    >
      <ModalHeader>
        <ModalTitle>
          <Trans>Need material</Trans>
        </ModalTitle>
      </ModalHeader>
      <ModalBody>
        <RequestFields operationId={operationId} />
      </ModalBody>
      <ModalFooter>
        <HStack>
          <Button variant="secondary" size="lg" onClick={onClose}>
            <Trans>Cancel</Trans>
          </Button>
          <Submit size="lg" isLoading={fetcher.state !== "idle"}>
            <Trans>Request material</Trans>
          </Submit>
        </HStack>
      </ModalFooter>
    </ValidatedForm>
  );
}

/** Inside the form: what is asked for, and the note that goes with it. */
function RequestFields({ operationId }: { operationId: string }) {
  const { t } = useLingui();
  const { clearError } = useField("note");
  const [search, setSearch] = useState("");
  const onSearch = useDebounce(setSearch, 300);
  // The job's own items load once; only the catalog follows the search.
  const jobQuery = useLoaderQuery<typeof jobItemsLoader>(
    path.to.api.materialRequestJobItems(operationId)
  );
  const catalogQuery = useLoaderQuery<typeof catalogLoader>(
    path.to.api.materialRequestCatalog(search),
    { keepPreviousData: true }
  );
  // No item is a request for something off the list, told in the note.
  const [selected, setSelected] = useState<RequestableItem | null>(null);

  const jobItems = jobQuery.data?.items ?? [];
  const jobItemIds = new Set(jobItems.map((item) => item.id));
  const term = search.trim().toLowerCase();
  const found = [
    ...jobItems.filter(
      (item) =>
        item.name.toLowerCase().includes(term) ||
        (item.readableIdWithRevision ?? "").toLowerCase().includes(term)
    ),
    ...(catalogQuery.data?.items ?? []).filter(
      (item) => !jobItemIds.has(item.id)
    )
  ];
  // The choice stays in sight when the search moves on from it.
  const options =
    selected && !found.some((option) => option.id === selected.id)
      ? [selected, ...found]
      : found;

  return (
    <>
      <Hidden name="jobOperationId" value={operationId} />
      <Hidden name="itemId" value={selected?.id ?? ""} />
      <VStack spacing={4}>
        <InputGroup size="lg">
          <InputLeftElement>
            {jobQuery.isFetching || catalogQuery.isFetching ? (
              <Spinner className="size-4" />
            ) : (
              <LuSearch className="size-4 text-muted-foreground" />
            )}
          </InputLeftElement>
          <Input
            type="search"
            placeholder={t`Search parts, consumables and tools`}
            aria-label={t`Search parts, consumables and tools`}
            onChange={(event) => onSearch(event.target.value)}
            // Enter (a scanner sends one) searches: it must not send the request.
            onKeyDown={(event) => {
              if (event.key === "Enter") event.preventDefault();
            }}
          />
        </InputGroup>
        <div
          role="radiogroup"
          aria-label={t`What do you need?`}
          className="flex max-h-[40vh] w-full flex-col gap-2 overflow-y-auto scrollbar-thin scrollbar-thumb-accent scrollbar-track-transparent"
        >
          <Option
            isSelected={selected === null}
            onSelect={() => setSelected(null)}
            media={
              <div className="flex size-11 items-center justify-center rounded-lg bg-muted">
                <LuMessageSquarePlus className="size-6 text-muted-foreground" />
              </div>
            }
            title={<Trans>Something else</Trans>}
            description={<Trans>Not on the list: describe it below</Trans>}
          />
          {options.map((option) => (
            <Option
              key={option.id}
              isSelected={selected?.id === option.id}
              onSelect={() => {
                setSelected(option);
                // The note was only required without an item.
                clearError();
              }}
              media={
                <ItemThumbnail
                  size="lg"
                  thumbnailPath={option.thumbnailPath}
                  type={option.type}
                />
              }
              title={option.readableIdWithRevision ?? option.name}
              description={option.name}
              badge={
                jobItemIds.has(option.id) && (
                  <Badge variant="secondary">
                    <Trans>This job</Trans>
                  </Badge>
                )
              }
            />
          ))}
          {(jobQuery.isError || catalogQuery.isError) && (
            <p className="px-1 text-sm text-muted-foreground">
              <Trans>
                The list failed to load. You can still describe what you need.
              </Trans>
            </p>
          )}
        </div>
        <TextArea
          name="note"
          label={selected ? t`Note` : t`What do you need?`}
          placeholder={
            selected
              ? t`How many, where, anything the feeder should know`
              : t`Describe it: what, how many, where`
          }
          size="lg"
          // A hint: without an item, the note is the request.
          isOptional={selected !== null}
        />
      </VStack>
    </>
  );
}

function Option({
  isSelected,
  onSelect,
  media,
  title,
  description,
  badge
}: {
  isSelected: boolean;
  onSelect: () => void;
  media: ReactNode;
  title: ReactNode;
  description: ReactNode;
  badge?: ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={isSelected}
      onClick={onSelect}
      className={cn(
        "flex w-full shrink-0 items-center gap-3 rounded-lg border p-2 text-left",
        isSelected ? "border-primary bg-accent" : "border-border"
      )}
    >
      {media}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-base/6 font-medium">{title}</span>
        <span className="truncate text-sm text-muted-foreground">
          {description}
        </span>
      </span>
      {badge}
      <LuCheck
        aria-hidden
        className={cn("size-5 shrink-0", !isSelected && "invisible")}
      />
    </button>
  );
}
