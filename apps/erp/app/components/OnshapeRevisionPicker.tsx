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
import type { loader as revisionsLoader } from "~/routes/api+/integrations.onshape.revisions";
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
  revisionId: string | null;
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
  /**
   * Restrict to one numeric Onshape elementType. A BOM import passes 1
   * (Assembly): a Part Studio body has no bill of materials, so offering one
   * would be offering a choice that cannot work.
   */
  onlyElementType?: number;
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
  isSubmitting = false,
  onlyElementType
}: Props) => {
  const { t } = useLingui();
  const fetcher = useFetcher<typeof revisionsLoader>();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Revision | null>(null);

  // Load on open rather than on mount: the sweep costs real Onshape calls, so
  // it should not run for everyone who happens to render the parts list.
  useEffect(() => {
    if (isOpen && fetcher.state === "idle" && !fetcher.data) {
      fetcher.load(path.to.api.onShapeRevisions);
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
    const matched = revisions.filter((revision) => {
      if (
        onlyElementType !== undefined &&
        revision.elementType !== onlyElementType
      ) {
        return false;
      }
      if (hideLinked && revision.linked) return false;
      if (!needle) return true;
      return (
        revision.partNumber.toLowerCase().includes(needle) ||
        (revision.name ?? "").toLowerCase().includes(needle)
      );
    });

    // Onshape returns these grouped by RELEASE, so one part's revisions land
    // pages apart and every row of a given release looks alike. Group by part
    // number instead, newest revision first — the newest is what someone
    // creating a part almost always wants, and the alternative is counting
    // occurrences of an identical-looking row.
    const sorted = [...matched].sort((a, b) => {
      const byNumber = a.partNumber.localeCompare(b.partNumber, undefined, {
        numeric: true,
        sensitivity: "base"
      });
      if (byNumber !== 0) return byNumber;
      return b.revision.localeCompare(a.revision, undefined, {
        numeric: true,
        sensitivity: "base"
      });
    });

    // The first row of each part number is its newest revision, by the sort
    // above. Flagged rather than left implicit: without it the only difference
    // between three rows is a one-character badge.
    const latest = new Set<string>();
    for (const revision of sorted) {
      if (!latest.has(revision.partNumber)) latest.add(revision.partNumber);
    }
    const seen = new Set<string>();
    return sorted.map((revision) => {
      const isLatest = !seen.has(revision.partNumber);
      seen.add(revision.partNumber);
      return { revision, isLatest };
    });
  }, [revisions, search, hideLinked, onlyElementType]);

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
        {/* min-w-0 all the way down. ModalContent is a CSS GRID, and a grid
            item's default `min-width: auto` lets it size the track to its own
            max-content — so one 80-character Onshape part number widened the
            track to 1012px inside a 576px dialog and every row, the search box
            and the footer buttons rendered outside the panel. Filtering the
            long row away made it snap back, which is what made it look like a
            rendering glitch rather than a sizing rule. */}
        <ModalBody className="min-w-0">
          <VStack spacing={4} className="min-w-0">
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
              <div className="max-h-[420px] w-full min-w-0 overflow-y-auto overflow-x-hidden rounded-md border">
                {visible.map(({ revision, isLatest }) => {
                  const isSelected =
                    selected?.externalId === revision.externalId &&
                    selected?.revision === revision.revision;
                  const kind =
                    revision.elementType === ELEMENT_TYPE_ASSEMBLY
                      ? t`Assembly`
                      : t`Part`;
                  return (
                    <button
                      type="button"
                      key={`${revision.externalId}:${revision.revision}`}
                      onClick={() => setSelected(revision)}
                      aria-pressed={isSelected}
                      // The revision letter is the ONLY thing separating three
                      // otherwise identical rows, and a Badge renders it as bare
                      // text with no role — so a screen reader could not tell
                      // them apart at all. Name the row in full.
                      aria-label={`${revision.partNumber} ${t`revision`} ${revision.revision}, ${kind}${
                        revision.name ? `, ${revision.name}` : ""
                      }`}
                      className={cn(
                        "flex w-full items-center justify-between gap-3 border-b px-3 py-2 text-left last:border-b-0 hover:bg-accent",
                        // Selection has to be unmissable in a list of rows that
                        // differ by one character. A faint fill was not.
                        isSelected &&
                          "bg-accent ring-2 ring-inset ring-primary hover:bg-accent"
                      )}
                    >
                      {/* min-w-0 is load-bearing: without it a flex child
                          refuses to shrink below its content, so `truncate` on
                          the part number never engages and one long unbroken
                          number (Onshape allows 80+ characters) widens the row
                          past the dialog. */}
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="truncate font-medium">
                            {revision.partNumber}
                          </span>
                          <Badge variant="secondary" className="shrink-0">
                            {revision.revision}
                          </Badge>
                          <Badge variant="outline" className="shrink-0">
                            {kind}
                          </Badge>
                          {isLatest && (
                            <Badge variant="blue" className="shrink-0">
                              <Trans>Latest</Trans>
                            </Badge>
                          )}
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
