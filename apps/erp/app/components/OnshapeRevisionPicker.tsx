import { OnshapeLogo } from "@carbon/ee";
import {
  Badge,
  Button,
  cn,
  HStack,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  Spinner,
  toast,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useMemo, useState } from "react";
import { LuSearch, LuTriangleAlert } from "react-icons/lu";
import { useFetcher } from "react-router";
import type { loader as revisionsLoader } from "~/routes/api+/integrations.onshape.v2.revisions";
import { path } from "~/utils/path";

type Revision = {
  partNumber: string;
  revision: string;
  name: string | null;
  documentId: string;
  versionId: string;
  elementId: string;
  elementType: number;
  partId: string | null;
  releaseId: string | null;
  externalId: string;
  linked: boolean;
};

// 0 Part Studio, 1 Assembly. Drawings (2) never reach the picker — the API
// route filters them out, since a released drawing shares the number of the
// model it documents and must attach to that item rather than become one.
const ELEMENT_TYPE_ASSEMBLY = 1;

export type OnshapeSelection = Revision;

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (selection: OnshapeSelection) => void;
  title: string;
  description: string;
  /**
   * Hide parts already linked to a Carbon item. True for creating (a second
   * item for the same CAD part is the duplication the mapping prevents), false
   * for linking, where the caller may legitimately be re-pointing.
   */
  hideLinked?: boolean;
  confirmLabel: string;
  isSubmitting?: boolean;
};

/**
 * Pick a released Onshape revision.
 *
 * Released only, by design: Onshape stamps a revision only on release, so an
 * unreleased version carries no revision and no assets. Choosing here is what
 * makes the Carbon item's number and revision match Onshape by construction
 * rather than by someone typing them — including lowercase part numbers, which
 * the new-part form cannot accept at all because it uppercases what is typed.
 */
export const OnshapeRevisionPicker = ({
  isOpen,
  onClose,
  onSelect,
  title,
  description,
  hideLinked = false,
  confirmLabel,
  isSubmitting = false
}: Props) => {
  const { t } = useLingui();
  const fetcher = useFetcher<typeof revisionsLoader>();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Revision | null>(null);

  // Load on open rather than on mount: the sweep costs real Onshape calls, so
  // it should not run for everyone who happens to render the parts list.
  useEffect(() => {
    if (isOpen && fetcher.state === "idle" && !fetcher.data) {
      fetcher.load(path.to.api.onShapeV2Revisions);
    }
  }, [isOpen, fetcher]);

  const error = fetcher.data?.error ?? null;
  const revisions = useMemo<Revision[]>(
    () => fetcher.data?.data?.revisions ?? [],
    [fetcher.data]
  );
  const truncated = fetcher.data?.data?.truncated ?? false;

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return revisions.filter((revision) => {
      if (hideLinked && revision.linked) return false;
      if (!needle) return true;
      return (
        revision.partNumber.toLowerCase().includes(needle) ||
        (revision.name ?? "").toLowerCase().includes(needle)
      );
    });
  }, [revisions, search, hideLinked]);

  const isLoading = fetcher.state !== "idle";

  return (
    <Modal
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          setSelected(null);
          setSearch("");
          onClose();
        }
      }}
    >
      <ModalContent size="large">
        <ModalHeader>
          <HStack className="items-center gap-2">
            <OnshapeLogo className="h-5 w-auto" />
            <ModalTitle>{title}</ModalTitle>
          </HStack>
          <ModalDescription>{description}</ModalDescription>
        </ModalHeader>
        <ModalBody>
          <VStack spacing={4}>
            <div className="relative w-full">
              <LuSearch className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t`Search by part number or name`}
                isDisabled={isLoading || !!error}
                className="pl-9"
              />
            </div>

            {error && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
                <LuTriangleAlert className="mt-0.5 shrink-0 text-destructive" />
                <span>{error}</span>
              </div>
            )}

            {isLoading && (
              <HStack className="w-full justify-center py-8">
                <Spinner />
                <span className="text-sm text-muted-foreground">
                  <Trans>Loading released revisions from Onshape…</Trans>
                </span>
              </HStack>
            )}

            {!isLoading && !error && visible.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">
                {revisions.length === 0 ? (
                  <Trans>
                    No released revisions found in Onshape. Only released
                    revisions can be imported — release the part in Onshape
                    first.
                  </Trans>
                ) : (
                  <Trans>No revisions match that search.</Trans>
                )}
              </p>
            )}

            {!isLoading && !error && visible.length > 0 && (
              <div className="max-h-[420px] w-full overflow-y-auto rounded-md border">
                {visible.map((revision) => {
                  const isSelected =
                    selected?.externalId === revision.externalId &&
                    selected?.revision === revision.revision;
                  return (
                    <button
                      type="button"
                      key={`${revision.externalId}:${revision.revision}`}
                      onClick={() => setSelected(revision)}
                      className={cn(
                        "flex w-full items-center justify-between gap-3 border-b px-3 py-2 text-left last:border-b-0 hover:bg-accent",
                        isSelected && "bg-accent"
                      )}
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-medium">
                            {revision.partNumber}
                          </span>
                          <Badge variant="secondary">{revision.revision}</Badge>
                          <Badge variant="outline">
                            {revision.elementType === ELEMENT_TYPE_ASSEMBLY
                              ? t`Assembly`
                              : t`Part`}
                          </Badge>
                        </div>
                        {revision.name && (
                          <p className="truncate text-xs text-muted-foreground">
                            {revision.name}
                          </p>
                        )}
                      </div>
                      {revision.linked && (
                        <Badge variant="green" className="shrink-0">
                          <Trans>Already in Carbon</Trans>
                        </Badge>
                      )}
                    </button>
                  );
                })}
              </div>
            )}

            {truncated && (
              <p className="text-xs text-muted-foreground">
                <Trans>
                  Showing the most recent releases only — this Onshape company
                  has more than this list can load at once. Search narrows what
                  is shown here, not what was loaded.
                </Trans>
              </p>
            )}
          </VStack>
        </ModalBody>
        <ModalFooter>
          <HStack>
            <Button
              variant="secondary"
              onClick={onClose}
              isDisabled={isSubmitting}
            >
              <Trans>Cancel</Trans>
            </Button>
            <Button
              isDisabled={!selected || isSubmitting}
              isLoading={isSubmitting}
              onClick={() => {
                if (!selected) return;
                if (selected.linked && hideLinked) {
                  toast.error(
                    t`That Onshape part is already linked to a Carbon item.`
                  );
                  return;
                }
                onSelect(selected);
              }}
            >
              {confirmLabel}
            </Button>
          </HStack>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

export default OnshapeRevisionPicker;
