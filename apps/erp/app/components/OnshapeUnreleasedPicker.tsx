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
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import { LuChevronRight, LuTriangleAlert } from "react-icons/lu";
import { useFetcher } from "react-router";
import type { loader as documentsLoader } from "~/routes/api+/integrations.onshape.documents";
import type { loader as elementsLoader } from "~/routes/api+/integrations.onshape.elements";
import type { loader as versionsLoader } from "~/routes/api+/integrations.onshape.versions";
import { path } from "~/utils/path";
import type { OnshapeSelection } from "./OnshapeRevisionPicker";

const ELEMENT_TYPE_ASSEMBLY = 1;

type Step = "document" | "version" | "element";

/**
 * Pick an assembly from a version that was never released.
 *
 * This is a SECOND path, not a mode of the released picker, because the two
 * are shaped by different Onshape facts. A released revision is a company-wide
 * record you can list and search directly; an unreleased version is not
 * addressable that way at all — it only exists inside a document, so the only
 * route to one is document → version → element.
 *
 * The versions step goes through the v2 loader rather than the legacy one so
 * each version says whether it carries a release. Without that the list is a
 * wall of names with nothing to choose between, and the user takes the
 * unreleased path for a version they could have picked properly.
 */
export const OnshapeUnreleasedPicker = ({
  isOpen,
  onClose,
  onSelect
}: {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (selection: OnshapeSelection) => void;
}) => {
  const { t } = useLingui();
  const [step, setStep] = useState<Step>("document");
  const [document, setDocument] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [version, setVersion] = useState<{ id: string; name: string } | null>(
    null
  );

  const documents = useFetcher<typeof documentsLoader>();
  const versions = useFetcher<typeof versionsLoader>();
  const elements = useFetcher<typeof elementsLoader>();

  // biome-ignore lint/correctness/useExhaustiveDependencies: fetchers are new objects every render
  useEffect(() => {
    if (!isOpen) return;
    documents.load(path.to.api.onShapeDocuments);
  }, [isOpen]);

  const chooseDocument = (chosen: { id: string; name: string }) => {
    setDocument(chosen);
    setVersion(null);
    setStep("version");
    versions.load(
      `${path.to.api.onShapeVersions}?did=${encodeURIComponent(chosen.id)}`
    );
  };

  const chooseVersion = (chosen: { id: string; name: string }) => {
    if (!document) return;
    setVersion(chosen);
    setStep("element");
    elements.load(
      `${path.to.api.onShapeElements}?did=${encodeURIComponent(document.id)}&vid=${encodeURIComponent(chosen.id)}`
    );
  };

  const chooseElement = (chosen: {
    id: string;
    name: string;
    partNumber?: string | null;
  }) => {
    if (!document || !version) return;
    onSelect({
      // The element NAME and its PART NUMBER are different Onshape fields and
      // diverge freely. The part number is what becomes the Carbon item, so it
      // is what travels — the name is only a label. Neither is the join;
      // resolution is by element id either way.
      partNumber: chosen.partNumber ?? "",
      revision: "",
      name: chosen.name,
      documentId: document.id,
      versionId: version.id,
      elementId: chosen.id,
      elementType: ELEMENT_TYPE_ASSEMBLY,
      partId: null,
      releaseId: null,
      revisionId: null,
      externalId: `${document.id}:${chosen.id}`,
      linked: false
    });
  };

  const error =
    documents.data?.error ?? versions.data?.error ?? elements.data?.error;
  const isLoading =
    documents.state !== "idle" ||
    versions.state !== "idle" ||
    elements.state !== "idle";

  // The documents loader answers `{ data: [] }` on failure and
  // `{ data: { items } }` on success, so the array case is the error case.
  const documentRows = documents.data?.data;
  const rows: Array<{
    id: string;
    name: string;
    released?: boolean;
    partNumber?: string | null;
  }> =
    step === "document"
      ? Array.isArray(documentRows)
        ? []
        : (documentRows?.items ?? [])
      : step === "version"
        ? (versions.data?.data?.versions ?? [])
        : (elements.data?.data?.elements ?? []);

  return (
    <Modal
      open={isOpen}
      onOpenChange={(open) => {
        if (open) return;
        setStep("document");
        setDocument(null);
        setVersion(null);
        onClose();
      }}
    >
      <ModalContent>
        <ModalHeader>
          <ModalTitle>
            <HStack spacing={2}>
              <OnshapeLogo className="size-4" />
              <Trans>Import an unreleased version</Trans>
            </HStack>
          </ModalTitle>
          <ModalDescription>
            <Trans>
              An unreleased version carries no revision, so its parts can only
              land on Carbon's initial revision — a part Carbon already holds at
              a named revision will be skipped. Models are still exported from
              this version. Prefer a released revision where there is one.
            </Trans>
          </ModalDescription>
        </ModalHeader>
        <ModalBody>
          <VStack spacing={2} className="w-full">
            <HStack
              spacing={1}
              className="w-full text-sm text-muted-foreground"
            >
              <button
                type="button"
                className={cn(step === "document" && "text-foreground")}
                onClick={() => setStep("document")}
              >
                {document?.name ?? t`Document`}
              </button>
              {document && (
                <>
                  <LuChevronRight className="size-3 shrink-0" />
                  <button
                    type="button"
                    className={cn(step === "version" && "text-foreground")}
                    onClick={() => setStep("version")}
                  >
                    {version?.name ?? t`Version`}
                  </button>
                </>
              )}
              {version && (
                <>
                  <LuChevronRight className="size-3 shrink-0" />
                  <span className={cn(step === "element" && "text-foreground")}>
                    <Trans>Assembly</Trans>
                  </span>
                </>
              )}
            </HStack>

            {error && (
              <div className="flex w-full items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
                <LuTriangleAlert className="mt-0.5 shrink-0 text-destructive" />
                <span>{error}</span>
              </div>
            )}

            {step === "version" && versions.data?.data?.releasedUnknown && (
              <div className="flex w-full items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
                <LuTriangleAlert className="mt-0.5 shrink-0 text-amber-600" />
                <span>
                  <Trans>
                    Carbon could not read every release in this Onshape company,
                    so a version marked Unreleased here may in fact be released.
                    Check in Onshape before importing one.
                  </Trans>
                </span>
              </div>
            )}

            {step === "element" && elements.data?.data?.truncated && (
              <p className="w-full text-xs text-muted-foreground">
                <Trans>
                  Showing the first assemblies only — this version has more than
                  Carbon lists here.
                </Trans>
              </p>
            )}

            {step === "element" &&
              elements.data?.data?.partNumbersIncomplete && (
                <div className="flex w-full items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
                  <LuTriangleAlert className="mt-0.5 shrink-0 text-amber-600" />
                  <span>
                    <Trans>
                      Carbon could not read every part number from Onshape, so
                      an assembly shown without one may in fact have one. Try
                      again, or check it in Onshape before importing.
                    </Trans>
                  </span>
                </div>
              )}

            {step === "version" && versions.data?.data?.truncated && (
              <p className="w-full text-xs text-muted-foreground">
                <Trans>
                  Showing the most recent versions only — this document has more
                  than Carbon lists here.
                </Trans>
              </p>
            )}

            {isLoading && (
              <HStack className="w-full justify-center py-6">
                <Spinner />
              </HStack>
            )}

            {!isLoading && !error && rows.length === 0 && (
              <p className="w-full py-6 text-center text-sm text-muted-foreground">
                {step === "element" ? (
                  <Trans>This version has no assemblies.</Trans>
                ) : (
                  <Trans>Nothing to choose here.</Trans>
                )}
              </p>
            )}

            {!isLoading && rows.length > 0 && (
              <div className="max-h-[360px] w-full overflow-y-auto rounded-md border">
                {rows.map((row) => (
                  <button
                    type="button"
                    key={row.id}
                    className="flex w-full items-center justify-between gap-3 border-b px-3 py-2 text-left text-sm last:border-b-0 hover:bg-accent"
                    onClick={() => {
                      if (step === "document") chooseDocument(row);
                      else if (step === "version") chooseVersion(row);
                      else chooseElement(row);
                    }}
                  >
                    {step === "element" ? (
                      <span className="min-w-0 truncate">
                        <span className="font-medium">
                          {row.partNumber ?? t`No part number`}
                        </span>
                        <span className="text-muted-foreground">
                          {" "}
                          {row.name}
                        </span>
                      </span>
                    ) : (
                      <span className="truncate">{row.name}</span>
                    )}
                    {step === "version" &&
                      (row.released ? (
                        <Badge variant="green">
                          <Trans>Released</Trans>
                        </Badge>
                      ) : (
                        <Badge variant="secondary">
                          <Trans>Unreleased</Trans>
                        </Badge>
                      ))}
                  </button>
                ))}
              </div>
            )}
          </VStack>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={onClose}>
            <Trans>Cancel</Trans>
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};
