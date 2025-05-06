import { useCarbon } from "@carbon/auth";
import { Boolean, DatePicker, ValidatedForm } from "@carbon/form";
import type { JSONContent } from "@carbon/react";
import {
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Combobox,
  HStack,
  Label,
  Loading,
  Modal,
  ModalBody,
  ModalContent,
  ModalDrawer,
  ModalDrawerBody,
  ModalDrawerContent,
  ModalDrawerFooter,
  ModalDrawerHeader,
  ModalDrawerProvider,
  ModalDrawerTitle,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  toast,
  useDisclosure,
  VStack,
} from "@carbon/react";
import { useFetcher } from "@remix-run/react";
import { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { LuDraftingCompass, LuHash, LuShapes, LuShield } from "react-icons/lu";
import type { z } from "zod";
import { Enumerable } from "~/components/Enumerable";
import { Hidden, Submit } from "~/components/Form";
import { useGauges } from "~/components/Form/Gauge";
import { usePermissions, useUser } from "~/hooks";

import { Editor } from "@carbon/react/Editor";
import { nanoid } from "nanoid";
import { getPrivateUrl, path } from "~/utils/path";
import { gaugeCalibrationRecordValidator } from "../../quality.models";
import type { Gauge } from "../../types";
import { GaugeRole } from "../Gauge/GaugeStatus";

type GaugeCalibrationRecordFormValues = z.infer<
  typeof gaugeCalibrationRecordValidator
>;

type GaugeCalibrationRecordFormProps = {
  initialValues: GaugeCalibrationRecordFormValues;
  type?: "modal" | "drawer";
  open?: boolean;
  onClose?: () => void;
};

const GaugeCalibrationRecordForm = ({
  initialValues,
  open = true,
  type = "drawer",
  onClose,
}: GaugeCalibrationRecordFormProps) => {
  const permissions = usePermissions();
  const fetcher = useFetcher<{}>();
  const isEditing = initialValues.id !== undefined;
  const isDisabled = isEditing
    ? !permissions.can("update", "quality")
    : !permissions.can("create", "quality");

  const [selectedGauge, setSelectedGauge] = useState<Gauge | null>(null);
  const gaugeSelectionModal = useDisclosure({
    defaultIsOpen: !initialValues.gaugeId,
  });
  const [loading, setLoading] = useState(false);

  const { carbon } = useCarbon();
  const { options: gaugeOptions, gaugeTypes } = useGauges();

  useEffect(() => {
    if (initialValues.gaugeId) {
      onGaugeSelected(initialValues.gaugeId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialValues.gaugeId]);

  const onGaugeSelected = async (gaugeId: string) => {
    flushSync(() => {
      setLoading(true);
    });
    const result = await carbon
      ?.from("gauges")
      .select("*")
      .eq("id", gaugeId)
      .single();
    if (!result?.data) {
      toast.error("Gauge not found");
      setSelectedGauge(null);
      setLoading(false);
      return;
    }
    setSelectedGauge(result.data);
    setLoading(false);
  };

  const [notes, setNotes] = useState<JSONContent>(
    (JSON.parse(initialValues?.notes ?? {}) as JSONContent) ?? {}
  );

  const {
    company: { id: companyId },
  } = useUser();

  const onUploadImage = async (file: File) => {
    const fileType = file.name.split(".").pop();
    const fileName = `${companyId}/quality/${nanoid()}.${fileType}`;

    const result = await carbon?.storage.from("private").upload(fileName, file);

    if (result?.error) {
      toast.error("Failed to upload image");
      throw new Error(result.error.message);
    }

    if (!result?.data) {
      throw new Error("Failed to upload image");
    }

    return getPrivateUrl(result.data.path);
  };

  return (
    <ModalDrawerProvider type={type}>
      <ModalDrawer
        open={open}
        onOpenChange={(open) => {
          if (!open && onClose) onClose();
        }}
      >
        <ModalDrawerContent>
          <ValidatedForm
            method="post"
            validator={gaugeCalibrationRecordValidator}
            defaultValues={initialValues}
            fetcher={fetcher}
            action={
              isEditing
                ? path.to.gaugeCalibrationRecord(initialValues.id!)
                : path.to.newGaugeCalibrationRecord
            }
            className="flex flex-col h-full"
          >
            <ModalDrawerHeader>
              <ModalDrawerTitle>
                {isEditing
                  ? "Edit Gauge Calibration Record"
                  : "New Gauge Calibration Record"}
              </ModalDrawerTitle>
            </ModalDrawerHeader>
            <ModalDrawerBody>
              <Hidden name="id" />
              <Hidden name="type" value={type} />
              <Hidden name="notes" value={JSON.stringify(notes)} />

              <VStack spacing={4}>
                <Card className="p-2">
                  <Loading isLoading={loading}>
                    <HStack className="w-full justify-between">
                      <CardHeader>
                        <CardTitle>
                          {selectedGauge?.gaugeId ?? "No Gauge Selected"}
                        </CardTitle>
                        {selectedGauge?.description && (
                          <CardDescription>
                            {selectedGauge.description}
                          </CardDescription>
                        )}
                        <Hidden
                          name="gaugeId"
                          value={
                            selectedGauge?.id ?? initialValues.gaugeId ?? ""
                          }
                        />
                      </CardHeader>
                      <CardAction>
                        <Button
                          leftIcon={<LuDraftingCompass />}
                          variant="secondary"
                          onClick={gaugeSelectionModal.onOpen}
                        >
                          Select Gauge
                        </Button>
                      </CardAction>
                    </HStack>
                    <CardContent>
                      <VStack>
                        {selectedGauge && (
                          <div className="w-full space-y-2 text-xs">
                            <div className="flex flex-col gap-4 py-2">
                              {selectedGauge.modelNumber && (
                                <div className="flex items-center gap-2">
                                  <LuHash className="text-muted-foreground" />
                                  <span className="font-medium">
                                    Model Number:
                                  </span>
                                  <span>
                                    {selectedGauge.modelNumber || "N/A"}
                                  </span>
                                </div>
                              )}
                              {selectedGauge.serialNumber && (
                                <div className="flex items-center gap-2">
                                  <LuHash className="text-muted-foreground" />
                                  <span className="font-medium">
                                    Serial Number:
                                  </span>
                                  <span>
                                    {selectedGauge.serialNumber || "N/A"}
                                  </span>
                                </div>
                              )}
                            </div>
                            <div className="flex flex-col gap-4">
                              <div className="flex items-center gap-2">
                                <LuShield className="text-muted-foreground" />
                                <span className="font-medium">Role:</span>
                                <GaugeRole role={selectedGauge.gaugeRole} />
                              </div>
                              <div className="flex items-center gap-2">
                                <LuShapes className="text-muted-foreground" />
                                <span className="font-medium">Type:</span>
                                <Enumerable
                                  value={
                                    gaugeTypes.find(
                                      (type) =>
                                        type.id === selectedGauge.gaugeTypeId
                                    )?.name ?? null
                                  }
                                />
                              </div>
                            </div>
                          </div>
                        )}
                      </VStack>
                    </CardContent>
                  </Loading>
                </Card>
                <DatePicker name="dateCalibrated" label="Date Calibrated" />
                <Boolean name="requiresAction" label="Requires Action" />
                <Boolean
                  name="requiresAdjustment"
                  label="Requires Adjustment"
                />
                <Boolean name="requiresRepair" label="Requires Repair" />
                <div className="flex flex-col gap-2 w-full">
                  <Label>Notes</Label>
                  <Editor
                    initialValue={notes}
                    onUpload={onUploadImage}
                    onChange={(value) => {
                      setNotes(value);
                    }}
                    className="[&_.is-empty]:text-muted-foreground min-h-[120px] py-3 px-4 border rounded-md w-full"
                  />
                </div>
              </VStack>
            </ModalDrawerBody>
            <ModalDrawerFooter>
              <HStack>
                {onClose && (
                  <Button size="md" variant="solid" onClick={onClose}>
                    Cancel
                  </Button>
                )}
                <Submit isDisabled={isDisabled}>Save</Submit>
              </HStack>
            </ModalDrawerFooter>
          </ValidatedForm>
        </ModalDrawerContent>
      </ModalDrawer>
      {gaugeSelectionModal.isOpen && (
        <Modal
          open={gaugeSelectionModal.isOpen}
          onOpenChange={(open) => {
            if (!open) gaugeSelectionModal.onClose();
          }}
        >
          <ModalContent>
            <ModalHeader>
              <ModalTitle>Select Gauge</ModalTitle>
            </ModalHeader>
            <ModalBody>
              <VStack className="w-full">
                <div className="w-full">
                  <Combobox
                    options={gaugeOptions}
                    onChange={(value) => {
                      onGaugeSelected(value);
                      gaugeSelectionModal.onClose();
                    }}
                    value={
                      selectedGauge?.id ?? initialValues.gaugeId ?? undefined
                    }
                    size="lg"
                  />
                </div>
              </VStack>
              <ModalFooter>
                <Button
                  variant="secondary"
                  onClick={() => {
                    if (
                      selectedGauge &&
                      selectedGauge.id !== initialValues.gaugeId
                    ) {
                      onGaugeSelected(initialValues.gaugeId!);
                    } else {
                      setSelectedGauge(null);
                    }
                    gaugeSelectionModal.onClose();
                  }}
                >
                  Cancel
                </Button>
                <Button onClick={gaugeSelectionModal.onClose}>Confirm</Button>
              </ModalFooter>
            </ModalBody>
          </ModalContent>
        </Modal>
      )}
    </ModalDrawerProvider>
  );
};

export default GaugeCalibrationRecordForm;
