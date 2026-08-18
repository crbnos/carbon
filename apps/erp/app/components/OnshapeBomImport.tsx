import { OnshapeLogo } from "@carbon/ee";
import {
  Badge,
  Button,
  cn,
  HStack,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  Spinner,
  toast,
  useDisclosure,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import { LuTriangleAlert } from "react-icons/lu";
import { useFetcher } from "react-router";
import { useOnshapePipeline } from "~/hooks/useOnshapePipeline";
import type { loader as bomLoader } from "~/routes/api+/integrations.onshape.v2.bom";
import type { action as importAction } from "~/routes/api+/integrations.onshape.v2.import";
import type { loader as versionsLoader } from "~/routes/api+/integrations.onshape.v2.versions";
import { path } from "~/utils/path";
import type { OnshapeSelection } from "./OnshapeRevisionPicker";
import { OnshapeRevisionPicker } from "./OnshapeRevisionPicker";

const ELEMENT_TYPE_ASSEMBLY = 1;

const ACTION_LABEL: Record<string, { label: string; variant: string }> = {
  update: { label: "Update", variant: "secondary" },
  create: { label: "New part", variant: "green" },
  "create-revision": { label: "Revision missing", variant: "yellow" },
  ambiguous: { label: "Ambiguous", variant: "destructive" }
};

/**
 * Import an Onshape assembly's BOM into a Carbon make method.
 *
 * Preview-then-confirm, and the preview says what will HAPPEN per row rather
 * than just listing rows — the legacy panel showed a row list with no
 * indication of which lines were about to create items.
 */
export const OnshapeBomImport = ({
  makeMethodId,
  isDisabled,
  disabledReason
}: {
  makeMethodId: string;
  isDisabled?: boolean;
  disabledReason?: string;
}) => {
  const { t } = useLingui();
  const picker = useDisclosure();
  const { allowUnreleasedSync } = useOnshapePipeline();
  // Unreleased picking is a SECOND path, not a mode of the released picker:
  // an unreleased version has no revision to select, so what the user chooses
  // is a document version rather than a released revision.
  const unreleasedPicker = useDisclosure();
  const versions = useFetcher<typeof versionsLoader>();
  const [selection, setSelection] = useState<OnshapeSelection | null>(null);
  // Which Onshape document the last released pick came from — the versions
  // loader needs a document, and only the released picker knows one.
  const [lastDocumentId, setLastDocumentId] = useState<string | null>(null);

  const preview = useFetcher<typeof bomLoader>();
  const importer = useFetcher<typeof importAction>();

  // Load the preview as soon as an assembly is chosen. Keyed on the SELECTION,
  // not on the fetcher: `preview` is a new object every render, and depending on
  // it would re-request the BOM in a loop.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the selection identity
  useEffect(() => {
    if (!selection) return;
    const params = new URLSearchParams({
      did: selection.documentId,
      vid: selection.versionId,
      eid: selection.elementId
    });
    preview.load(`${path.to.api.onShapeV2Bom}?${params}`);
  }, [selection]);

  useEffect(() => {
    if (importer.state !== "idle" || !importer.data) return;
    if (importer.data.success) {
      toast.success(importer.data.message ?? t`Import started`);
      setSelection(null);
    } else {
      toast.error(importer.data.message ?? t`Could not start the import`);
    }
  }, [importer.state, importer.data, t]);

  const rows = preview.data?.data?.rows ?? [];
  const summary = preview.data?.data?.summary;
  // Rows Onshape sent that Carbon cannot import at all — no part number, no
  // addressable source, or a parent that was itself dropped. Counting them
  // silently would present a partial BOM as the whole one.
  const droppedRows =
    (preview.data?.data?.skipped ?? 0) + (preview.data?.data?.orphaned ?? 0);
  const previewError = preview.data?.error ?? null;
  const isLoadingPreview = preview.state !== "idle";
  const isImporting = importer.state !== "idle";

  return (
    <>
      <div className="flex w-full flex-col gap-2 p-2">
        <Button
          className="w-full"
          variant="secondary"
          leftIcon={<OnshapeLogo className="h-4 w-auto" />}
          isDisabled={isDisabled}
          onClick={picker.onOpen}
        >
          <Trans>Import from Onshape</Trans>
        </Button>
        {isDisabled && disabledReason && (
          <p className="text-xs text-muted-foreground">{disabledReason}</p>
        )}
      </div>

      {allowUnreleasedSync && (
        <Button
          className="w-full"
          variant="secondary"
          isDisabled={isDisabled}
          onClick={() => {
            unreleasedPicker.onOpen();
            versions.load(
              `${path.to.api.onShapeV2Versions}?did=${encodeURIComponent(
                lastDocumentId ?? ""
              )}`
            );
          }}
        >
          <Trans>Import an unreleased version</Trans>
        </Button>
      )}

      {unreleasedPicker.isOpen && (
        <Modal
          open
          onOpenChange={(open) => {
            if (!open) unreleasedPicker.onClose();
          }}
        >
          <ModalContent>
            <ModalHeader>
              <ModalTitle>
                <Trans>Import an unreleased version</Trans>
              </ModalTitle>
              <ModalDescription>
                <Trans>
                  An unreleased version carries no revision and no released
                  assets, so its parts land on Carbon's initial revision. Pick
                  the released assembly first if there is one.
                </Trans>
              </ModalDescription>
            </ModalHeader>
            <ModalBody>
              {versions.state !== "idle" && (
                <HStack className="w-full justify-center py-6">
                  <Spinner />
                </HStack>
              )}
              {versions.data?.error && (
                <div className="flex w-full items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
                  <LuTriangleAlert className="mt-0.5 shrink-0 text-destructive" />
                  <span>{versions.data.error}</span>
                </div>
              )}
              {!lastDocumentId && versions.state === "idle" && (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  <Trans>
                    Pick a released assembly once first — Carbon needs to know
                    which Onshape document to look in.
                  </Trans>
                </p>
              )}
              {versions.data?.data && (
                <div className="max-h-[360px] w-full overflow-y-auto rounded-md border">
                  {versions.data.data.versions.map((version) => (
                    <div
                      key={version.id}
                      className="flex items-center justify-between gap-3 border-b px-3 py-2 text-sm last:border-b-0"
                    >
                      <span className="truncate">{version.name}</span>
                      {version.released ? (
                        <Badge variant="green">
                          <Trans>Released</Trans>
                        </Badge>
                      ) : (
                        <Badge variant="secondary">
                          <Trans>Unreleased</Trans>
                        </Badge>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </ModalBody>
            <ModalFooter>
              <Button variant="secondary" onClick={unreleasedPicker.onClose}>
                <Trans>Close</Trans>
              </Button>
            </ModalFooter>
          </ModalContent>
        </Modal>
      )}

      {picker.isOpen && !selection && (
        <OnshapeRevisionPicker
          isOpen={picker.isOpen}
          onClose={picker.onClose}
          onlyElementType={ELEMENT_TYPE_ASSEMBLY}
          title={t`Import a bill of materials`}
          description={t`Pick the released Onshape assembly to import. Only assemblies are listed — a Part Studio body has no bill of materials.`}
          confirmLabel={t`Preview`}
          onSelect={(revision) => {
            setSelection(revision);
            setLastDocumentId(revision.documentId);
            picker.onClose();
          }}
        />
      )}

      {selection && (
        <Modal
          open
          onOpenChange={(open) => {
            if (!open && !isImporting) setSelection(null);
          }}
        >
          <ModalContent size="large">
            <ModalHeader>
              <HStack className="items-center gap-2">
                <OnshapeLogo className="h-5 w-auto" />
                <ModalTitle>
                  {selection.partNumber} {selection.revision}
                </ModalTitle>
              </HStack>
              <ModalDescription>
                <Trans>
                  Every line is matched to Carbon by a hidden Onshape id, never
                  by part number. Nothing is written until you confirm.
                </Trans>
              </ModalDescription>
            </ModalHeader>
            <ModalBody>
              <VStack spacing={4}>
                {isLoadingPreview && (
                  <HStack className="w-full justify-center py-8">
                    <Spinner />
                    <span className="text-sm text-muted-foreground">
                      <Trans>Reading the bill of materials…</Trans>
                    </span>
                  </HStack>
                )}

                {previewError && (
                  <div className="flex w-full items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
                    <LuTriangleAlert className="mt-0.5 shrink-0 text-destructive" />
                    <span>{previewError}</span>
                  </div>
                )}

                {!isLoadingPreview && !previewError && summary && (
                  <>
                    <HStack className="w-full flex-wrap gap-2">
                      <Badge variant="secondary">
                        {summary.total} <Trans>lines</Trans>
                      </Badge>
                      {summary.update > 0 && (
                        <Badge variant="secondary">
                          {summary.update} <Trans>to update</Trans>
                        </Badge>
                      )}
                      {summary.create > 0 && (
                        <Badge variant="green">
                          {summary.create} <Trans>new parts</Trans>
                        </Badge>
                      )}
                      {summary.createRevision > 0 && (
                        <Badge variant="yellow">
                          {summary.createRevision}{" "}
                          <Trans>missing revisions</Trans>
                        </Badge>
                      )}
                      {summary.ambiguous > 0 && (
                        <Badge variant="destructive">
                          {summary.ambiguous} <Trans>ambiguous</Trans>
                        </Badge>
                      )}
                    </HStack>

                    {droppedRows > 0 && (
                      <div className="flex w-full items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
                        <LuTriangleAlert className="mt-0.5 shrink-0 text-destructive" />
                        <div>
                          <p className="font-medium">
                            <Trans>
                              {droppedRows} Onshape rows cannot be imported
                            </Trans>
                          </p>
                          <p className="text-muted-foreground">
                            <Trans>
                              They have no part number, or no addressable
                              source, or sit under a row that does. Give them a
                              part number in Onshape to include them.
                            </Trans>
                          </p>
                        </div>
                      </div>
                    )}

                    {(summary.createRevision > 0 || summary.ambiguous > 0) && (
                      <div className="flex w-full items-start gap-2 rounded-md border border-yellow-500/40 bg-yellow-500/5 p-3 text-sm">
                        <LuTriangleAlert className="mt-0.5 shrink-0 text-yellow-600" />
                        <div>
                          <p className="font-medium">
                            <Trans>Some lines will be skipped</Trans>
                          </p>
                          <p className="text-muted-foreground">
                            <Trans>
                              A line whose revision Carbon does not have is
                              skipped rather than created — new revisions arrive
                              through release import. A line two Carbon items
                              both claim is skipped for a person to resolve.
                              Everything else imports.
                            </Trans>
                          </p>
                        </div>
                      </div>
                    )}

                    <div className="max-h-[380px] w-full overflow-y-auto rounded-md border">
                      {rows.map((row) => {
                        const badge =
                          ACTION_LABEL[row.action] ?? ACTION_LABEL.create!;
                        return (
                          <div
                            key={`${row.externalId}:${row.item}`}
                            className="flex items-center justify-between gap-3 border-b px-3 py-2 text-sm last:border-b-0"
                          >
                            <div
                              className="min-w-0"
                              style={{
                                paddingLeft: `${row.indentLevel * 16}px`
                              }}
                            >
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-muted-foreground tabular-nums">
                                  {row.item}
                                </span>
                                <span className="truncate font-medium">
                                  {row.partNumber}
                                </span>
                                <Badge variant="secondary">
                                  {row.revision || t`no revision`}
                                </Badge>
                                <span className="text-xs text-muted-foreground tabular-nums">
                                  &times;{row.quantity}
                                </span>
                              </div>
                              {row.siblings.length > 0 && (
                                <p className="truncate text-xs text-muted-foreground">
                                  <Trans>
                                    Carbon has {row.siblings.join(", ")}
                                  </Trans>
                                </p>
                              )}
                            </div>
                            <Badge
                              variant={badge.variant as "secondary"}
                              className={cn("shrink-0")}
                            >
                              {badge.label}
                            </Badge>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </VStack>
            </ModalBody>
            <ModalFooter>
              <HStack>
                <Button
                  variant="secondary"
                  isDisabled={isImporting}
                  onClick={() => setSelection(null)}
                >
                  <Trans>Cancel</Trans>
                </Button>
                <Button
                  isLoading={isImporting}
                  isDisabled={
                    isImporting ||
                    isLoadingPreview ||
                    !!previewError ||
                    !summary
                  }
                  onClick={() => {
                    const formData = new FormData();
                    formData.append("makeMethodId", makeMethodId);
                    formData.append("documentId", selection.documentId);
                    formData.append("versionId", selection.versionId);
                    formData.append("elementId", selection.elementId);
                    formData.append("partNumber", selection.partNumber);
                    formData.append("revision", selection.revision);
                    formData.append(
                      "elementType",
                      String(selection.elementType)
                    );
                    importer.submit(formData, {
                      method: "post",
                      action: path.to.api.onShapeV2Import
                    });
                  }}
                >
                  <Trans>Import</Trans>
                </Button>
              </HStack>
            </ModalFooter>
          </ModalContent>
        </Modal>
      )}
    </>
  );
};

export default OnshapeBomImport;
