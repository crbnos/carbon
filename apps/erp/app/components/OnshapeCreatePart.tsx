import {
  Button,
  Combobox,
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
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import { useFetcher, useNavigate } from "react-router";
import type { action as createAction } from "~/routes/api+/integrations.onshape.v2.create";
import { path } from "~/utils/path";
import type { OnshapeSelection } from "./OnshapeRevisionPicker";
import { OnshapeRevisionPicker } from "./OnshapeRevisionPicker";

const ELEMENT_TYPE_ASSEMBLY = 1;

// Onshape supplies the part number, revision and name. It does NOT supply these
// — replenishment and tracking are business decisions, not CAD facts — so they
// are seeded from what the element is and then shown for confirmation rather
// than written silently. (The legacy BOM import derives replenishment from a
// "Purchasing Level" column and imports every new part as Make when that column
// is absent, with nothing on screen to say so.)
function seedFromElementType(elementType: number) {
  return elementType === ELEMENT_TYPE_ASSEMBLY
    ? { replenishmentSystem: "Make", defaultMethodType: "Make to Order" }
    : {
        replenishmentSystem: "Buy",
        defaultMethodType: "Pull from Inventory"
      };
}

export const OnshapeCreatePart = ({
  isOpen,
  onClose
}: {
  isOpen: boolean;
  onClose: () => void;
}) => {
  const { t } = useLingui();
  const navigate = useNavigate();
  const fetcher = useFetcher<typeof createAction>();

  const [selection, setSelection] = useState<OnshapeSelection | null>(null);
  const [replenishmentSystem, setReplenishmentSystem] = useState("Buy");
  const [defaultMethodType, setDefaultMethodType] = useState(
    "Pull from Inventory"
  );
  const [itemTrackingType, setItemTrackingType] = useState("Inventory");

  const isSubmitting = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;

    if (fetcher.data.success && fetcher.data.itemId) {
      toast.success(fetcher.data.message ?? t`Created part from Onshape`);
      const itemId = fetcher.data.itemId;
      setSelection(null);
      onClose();
      navigate(path.to.part(itemId));
    } else if (!fetcher.data.success) {
      toast.error(fetcher.data.message ?? t`Could not create the part`);
    }
  }, [fetcher.state, fetcher.data, navigate, onClose, t]);

  if (selection) {
    return (
      <Modal
        open
        onOpenChange={(open) => {
          if (!open && !isSubmitting) setSelection(null);
        }}
      >
        <ModalContent>
          <ModalHeader>
            <ModalTitle>
              {selection.partNumber} {selection.revision}
            </ModalTitle>
            <ModalDescription>
              <Trans>
                The part number, revision and name come from Onshape and cannot
                be edited here. Choose how Carbon should treat this part — you
                can change it later on the part itself.
              </Trans>
            </ModalDescription>
          </ModalHeader>
          <ModalBody>
            <VStack spacing={4}>
              <div className="w-full">
                <label
                  className="text-sm font-medium"
                  htmlFor="onshape-replenishment"
                >
                  <Trans>Replenishment System</Trans>
                </label>
                <Combobox
                  id="onshape-replenishment"
                  className="mt-1"
                  value={replenishmentSystem}
                  options={[
                    { label: t`Buy`, value: "Buy" },
                    { label: t`Make`, value: "Make" },
                    { label: t`Buy and Make`, value: "Buy and Make" }
                  ]}
                  onChange={(value) => {
                    const next = value ?? "Buy";
                    setReplenishmentSystem(next);
                    setDefaultMethodType(
                      next === "Buy" ? "Pull from Inventory" : "Make to Order"
                    );
                  }}
                />
              </div>
              <div className="w-full">
                <label
                  className="text-sm font-medium"
                  htmlFor="onshape-tracking"
                >
                  <Trans>Tracking Type</Trans>
                </label>
                <Combobox
                  id="onshape-tracking"
                  className="mt-1"
                  value={itemTrackingType}
                  options={[
                    { label: t`Inventory`, value: "Inventory" },
                    { label: t`Non-Inventory`, value: "Non-Inventory" },
                    { label: t`Serial`, value: "Serial" },
                    { label: t`Batch`, value: "Batch" }
                  ]}
                  onChange={(value) =>
                    setItemTrackingType(value ?? "Inventory")
                  }
                />
              </div>
            </VStack>
          </ModalBody>
          <ModalFooter>
            <HStack>
              <Button
                variant="secondary"
                isDisabled={isSubmitting}
                onClick={() => setSelection(null)}
              >
                <Trans>Back</Trans>
              </Button>
              <Button
                isLoading={isSubmitting}
                isDisabled={isSubmitting}
                onClick={() => {
                  const formData = new FormData();
                  // Identity only. The server re-resolves all of this against
                  // Onshape and persists ITS values, not these.
                  formData.append("partNumber", selection.partNumber);
                  formData.append("revision", selection.revision);
                  formData.append("elementType", String(selection.elementType));
                  formData.append("documentId", selection.documentId);
                  formData.append("versionId", selection.versionId);
                  formData.append("elementId", selection.elementId);
                  if (selection.partId) {
                    formData.append("partId", selection.partId);
                  }
                  if (selection.revisionId) {
                    formData.append("revisionId", selection.revisionId);
                  }
                  formData.append("replenishmentSystem", replenishmentSystem);
                  formData.append("defaultMethodType", defaultMethodType);
                  formData.append("itemTrackingType", itemTrackingType);
                  formData.append("unitOfMeasureCode", "EA");

                  fetcher.submit(formData, {
                    method: "post",
                    action: path.to.api.onShapeV2Create
                  });
                }}
              >
                <Trans>Create part</Trans>
              </Button>
            </HStack>
          </ModalFooter>
        </ModalContent>
      </Modal>
    );
  }

  return (
    <OnshapeRevisionPicker
      isOpen={isOpen}
      onClose={onClose}
      hideLinked
      title={t`New part from Onshape`}
      description={t`Pick a released revision. Carbon creates the part with Onshape's number and revision, linked by a hidden id so the two stay connected even if the number changes.`}
      confirmLabel={t`Continue`}
      onSelect={(revision) => {
        const seed = seedFromElementType(revision.elementType);
        setReplenishmentSystem(seed.replenishmentSystem);
        setDefaultMethodType(seed.defaultMethodType);
        setItemTrackingType("Inventory");
        setSelection(revision);
      }}
    />
  );
};

export default OnshapeCreatePart;
