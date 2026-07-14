import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  HStack,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  toast,
  VStack
} from "@carbon/react";
import { getItemReadableId } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useStore } from "@nanostores/react";
import { useEffect, useMemo, useState } from "react";
import { LuCircleCheck, LuGitMerge, LuTriangleAlert } from "react-icons/lu";
import { useFetcher } from "react-router";
import { useItems } from "~/stores";
import { path } from "~/utils/path";
import type {
  ChangeOrderItemDiff,
  ChangeOrderMergeChoice,
  ChangeOrderMergeResolution,
  ChangeOrderReleaseConflict,
  ChangeOrderReleaseConflictEntry
} from "../../changeOrder.models";
import { changeOrderMergeEntryKey } from "../../changeOrder.models";
import ChangeOrderConflictResolver from "./ChangeOrderConflictResolver";
import ChangeOrderDiffViewer from "./ChangeOrderDiffViewer";
import { releaseDialogOpenAtom } from "./releaseDialog.store";

// One affected item's read-only changes, shown in the release confirmation.
export type ReleaseChange = {
  id: string;
  label: string;
  diff?: ChangeOrderItemDiff;
};

// Per-line state key: the affected item plus the shared line identity, so the
// selection map spans all affected items without collisions.
function stateKey(
  affectedItemId: string,
  e: ChangeOrderReleaseConflictEntry
): string {
  return `${affectedItemId}:${changeOrderMergeEntryKey(e)}`;
}

// The Implementation → Done release control, rendered as a confirmation dialog
// (opened from the header button or the rail's Release section via
// releaseDialogOpenAtom). The user reviews every affected item's changes — and,
// when a same-part parallel CO moved the live method under a Version draft,
// resolves each conflict in a full-screen git-style resolver (Q3) — then confirms
// in the sticky footer. Release is never a one-click action.
export default function ChangeOrderReleaseMerge({
  changeOrderId,
  status,
  conflicts,
  changes
}: {
  changeOrderId: string;
  status: string | null;
  conflicts: ChangeOrderReleaseConflict[];
  changes: ReleaseChange[];
}) {
  const { t } = useLingui();
  const [items] = useItems();
  const fetcher = useFetcher<{ success?: boolean }>();
  const open = useStore(releaseDialogOpenAtom);

  useEffect(() => {
    const data = fetcher.data as
      | { error?: { message: string }; success?: boolean }
      | undefined;
    if (data?.error) toast.error(data.error.message);
    if (data?.success) releaseDialogOpenAtom.set(false);
  }, [fetcher.data]);

  // Close the dialog if this control unmounts (e.g. navigating away).
  useEffect(() => () => releaseDialogOpenAtom.set(false), []);

  // Per-line choice, seeded from the server's safe defaults.
  const [choices, setChoices] = useState<
    Record<string, ChangeOrderMergeChoice>
  >(() => {
    const seed: Record<string, ChangeOrderMergeChoice> = {};
    for (const c of conflicts) {
      for (const e of c.entries) {
        seed[stateKey(c.affectedItemId, e)] = e.defaultChoice;
      }
    }
    return seed;
  });

  // Parts the user has opened and confirmed. Release is gated until every
  // conflicting part is reviewed — defaults are pre-selected, so this is
  // "review & confirm", not busywork.
  const [resolvedParts, setResolvedParts] = useState<Set<string>>(new Set());
  const [openPartId, setOpenPartId] = useState<string | null>(null);

  const resolutions = useMemo<ChangeOrderMergeResolution[]>(
    () =>
      conflicts.flatMap((c) =>
        c.entries.map((e) => ({
          affectedItemId: c.affectedItemId,
          kind: e.kind,
          draftId: e.draftId,
          liveId: e.liveId,
          choice: choices[stateKey(c.affectedItemId, e)] ?? e.defaultChoice
        }))
      ),
    [conflicts, choices]
  );

  if (status !== "Implementation") return null;

  const hasConflicts = conflicts.length > 0;
  const isSubmitting = fetcher.state !== "idle";
  const allResolved = conflicts.every((c) =>
    resolvedParts.has(c.affectedItemId)
  );
  const openConflict =
    conflicts.find((c) => c.affectedItemId === openPartId) ?? null;

  const partLabel = (c: ChangeOrderReleaseConflict) =>
    getItemReadableId(items, c.itemId) ?? c.itemId;

  // Slice the master choice map down to the open part, keyed by the line-local
  // entry key the resolver expects.
  const openChoices: Record<string, ChangeOrderMergeChoice> = {};
  if (openConflict) {
    for (const e of openConflict.entries) {
      openChoices[changeOrderMergeEntryKey(e)] =
        choices[stateKey(openConflict.affectedItemId, e)] ?? e.defaultChoice;
    }
  }

  return (
    <>
      <Modal open={open} onOpenChange={(v) => releaseDialogOpenAtom.set(v)}>
        <ModalContent className="flex h-[90vh] w-[90vw] flex-col p-0 sm:max-w-3xl">
          <ModalHeader className="px-6 pt-6">
            <ModalTitle>
              <Trans>Release change order</Trans>
            </ModalTitle>
            <ModalDescription>
              <Trans>
                Review each item's changes, then confirm — releasing can't be
                undone.
              </Trans>
            </ModalDescription>
          </ModalHeader>

          <ModalBody className="flex-1 overflow-y-auto px-6 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent">
            <VStack spacing={4} className="w-full">
              {hasConflicts && (
                <Alert variant="warning">
                  <LuTriangleAlert className="size-4" />
                  <AlertTitle>
                    <Trans>The live method changed since you started</Trans>
                  </AlertTitle>
                  <AlertDescription>
                    <Trans>
                      Another change order released a newer version of{" "}
                      {conflicts.length === 1
                        ? t`this part`
                        : t`${conflicts.length} of these parts`}
                      . Resolve each one to choose which changes to keep before
                      releasing.
                    </Trans>
                  </AlertDescription>
                </Alert>
              )}

              {hasConflicts &&
                conflicts.map((c) => {
                  const isResolved = resolvedParts.has(c.affectedItemId);
                  return (
                    <HStack
                      key={c.affectedItemId}
                      className="w-full justify-between gap-3 rounded-xl border border-border p-3"
                    >
                      <VStack spacing={0}>
                        <span className="text-sm font-medium text-foreground">
                          {partLabel(c)}
                        </span>
                        <span className="text-xs text-muted-foreground tabular-nums">
                          <Trans>
                            {c.entries.length} conflicting change(s)
                          </Trans>
                        </span>
                      </VStack>
                      <HStack spacing={2}>
                        {isResolved ? (
                          <Badge variant="green">
                            <LuCircleCheck className="mr-1 size-3" />
                            <Trans>Resolved</Trans>
                          </Badge>
                        ) : (
                          <Badge variant="yellow">
                            <Trans>Review required</Trans>
                          </Badge>
                        )}
                        <Button
                          size="sm"
                          variant={isResolved ? "secondary" : "primary"}
                          leftIcon={<LuGitMerge />}
                          onClick={() => setOpenPartId(c.affectedItemId)}
                        >
                          {isResolved ? t`Review` : t`Resolve`}
                        </Button>
                      </HStack>
                    </HStack>
                  );
                })}

              {changes.length === 0 ? (
                <span className="text-sm italic text-muted-foreground">
                  <Trans>No affected items.</Trans>
                </span>
              ) : (
                changes.map((c) => (
                  <VStack key={c.id} spacing={2} className="w-full">
                    <h3 className="text-sm font-medium text-foreground">
                      {c.label}
                    </h3>
                    <ChangeOrderDiffViewer diff={c.diff} />
                  </VStack>
                ))
              )}
            </VStack>
          </ModalBody>

          <ModalFooter className="border-t border-border px-6 py-4">
            <HStack spacing={2} className="w-full justify-end">
              {hasConflicts && !allResolved && (
                <span className="mr-auto text-xs text-muted-foreground">
                  <Trans>Resolve every conflicting part to release.</Trans>
                </span>
              )}
              <Button
                variant="secondary"
                onClick={() => releaseDialogOpenAtom.set(false)}
                isDisabled={isSubmitting}
              >
                <Trans>Cancel</Trans>
              </Button>
              <fetcher.Form
                method="post"
                action={path.to.changeOrderStatus(changeOrderId)}
              >
                <input type="hidden" name="id" value={changeOrderId} />
                <input type="hidden" name="fromStatus" value="Implementation" />
                <input type="hidden" name="status" value="Done" />
                <input type="hidden" name="mergeAcknowledged" value="true" />
                <input
                  type="hidden"
                  name="resolutions"
                  value={JSON.stringify(resolutions)}
                />
                <Button
                  type="submit"
                  leftIcon={<LuCircleCheck />}
                  variant="primary"
                  isDisabled={isSubmitting || (hasConflicts && !allResolved)}
                  isLoading={isSubmitting}
                >
                  {hasConflicts ? t`Resolve & release` : t`Confirm & release`}
                </Button>
              </fetcher.Form>
            </HStack>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {openConflict && (
        <ChangeOrderConflictResolver
          open={openPartId !== null}
          partLabel={partLabel(openConflict)}
          conflict={openConflict}
          choices={openChoices}
          onChoice={(entryKey, choice) =>
            setChoices((p) => ({
              ...p,
              [`${openConflict.affectedItemId}:${entryKey}`]: choice
            }))
          }
          onSetAll={(choice) =>
            setChoices((p) => {
              const next = { ...p };
              for (const e of openConflict.entries) {
                next[stateKey(openConflict.affectedItemId, e)] = choice;
              }
              return next;
            })
          }
          onDone={() => {
            setResolvedParts((p) =>
              new Set(p).add(openConflict.affectedItemId)
            );
            setOpenPartId(null);
          }}
          onClose={() => setOpenPartId(null)}
        />
      )}
    </>
  );
}
