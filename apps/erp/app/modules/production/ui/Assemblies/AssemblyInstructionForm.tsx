import { useCarbon } from "@carbon/auth";
import { ValidatedForm } from "@carbon/form";
import {
  Alert,
  AlertDescription,
  HStack,
  ModalDrawer,
  ModalDrawerBody,
  ModalDrawerContent,
  ModalDrawerFooter,
  ModalDrawerHeader,
  ModalDrawerProvider,
  ModalDrawerTitle,
  VStack
} from "@carbon/react";
import { useCallback, useEffect, useState } from "react";
import { LuCircleCheck, LuInfo, LuTriangleAlert } from "react-icons/lu";
import type { z } from "zod";
import { Hidden, Item, Submit } from "~/components/Form";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import {
  assemblyInstructionFromItemValidator,
  getAssemblyModelState
} from "../../production.models";

type ModelStatus =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "converted"; label: string }
  | { state: "convertible" }
  | { state: "processing" }
  | { state: "failed"; error: string | null }
  | { state: "none" };

type AssemblyInstructionFormProps = {
  initialValues: z.infer<typeof assemblyInstructionFromItemValidator>;
  open?: boolean;
  onClose: () => void;
};

const AssemblyInstructionForm = ({
  initialValues,
  open = true,
  onClose
}: AssemblyInstructionFormProps) => {
  const permissions = usePermissions();
  const { carbon } = useCarbon();

  const [modelStatus, setModelStatus] = useState<ModelStatus>({
    state: "idle"
  });

  // Mirrors getModelForItem on the server: conversion is lazy, so any STEP
  // model is usable — the state just tells the user what will happen on save
  const checkModel = useCallback(
    async (itemId: string) => {
      if (!carbon || !itemId) {
        setModelStatus({ state: "idle" });
        return;
      }
      setModelStatus({ state: "loading" });

      const { data: item } = await carbon
        .from("item")
        .select("modelUploadId")
        .eq("id", itemId)
        .maybeSingle();

      if (!item?.modelUploadId) {
        setModelStatus({ state: "none" });
        return;
      }

      const { data: model } = await carbon
        .from("modelUpload")
        .select(
          "id, name, componentCount, processingStatus, processingError, glbPath, graphPath, modelPath"
        )
        .eq("id", item.modelUploadId)
        .maybeSingle();

      const state = getAssemblyModelState(model ?? null);
      switch (state) {
        case "converted": {
          const name = model!.name ?? "Model";
          setModelStatus({
            state,
            label:
              typeof model!.componentCount === "number"
                ? `${name} (${model!.componentCount} components)`
                : name
          });
          break;
        }
        case "failed":
          setModelStatus({ state, error: model!.processingError });
          break;
        default:
          setModelStatus({ state });
      }
    },
    [carbon]
  );

  useEffect(() => {
    if (initialValues.itemId) checkModel(initialValues.itemId);
  }, [initialValues.itemId, checkModel]);

  const isDisabled =
    !permissions.can("create", "production") ||
    ["idle", "loading", "none"].includes(modelStatus.state);

  return (
    <ModalDrawerProvider type="modal">
      <ModalDrawer
        open={open}
        onOpenChange={(open) => {
          if (!open) onClose?.();
        }}
      >
        <ModalDrawerContent>
          <ValidatedForm
            validator={assemblyInstructionFromItemValidator}
            method="post"
            action={path.to.newAssemblyInstruction}
            defaultValues={initialValues}
            className="flex flex-col h-full"
          >
            <ModalDrawerHeader>
              <ModalDrawerTitle>New Assembly Instruction</ModalDrawerTitle>
            </ModalDrawerHeader>
            <ModalDrawerBody>
              <Hidden name="id" />
              <VStack spacing={4}>
                {modelStatus.state === "convertible" && (
                  <Alert variant="info">
                    <LuInfo />
                    <AlertDescription>
                      This model will be converted for assembly instructions
                      when you save. This can take a minute.
                    </AlertDescription>
                  </Alert>
                )}
                {modelStatus.state === "processing" && (
                  <Alert variant="info">
                    <LuInfo />
                    <AlertDescription>
                      Model conversion is in progress. You can save now — the
                      model will appear once conversion finishes.
                    </AlertDescription>
                  </Alert>
                )}
                {modelStatus.state === "failed" && (
                  <Alert variant="warning">
                    <LuTriangleAlert />
                    <AlertDescription>
                      {modelStatus.error
                        ? `Previous model conversion failed: ${modelStatus.error}. Saving will retry.`
                        : "Previous model conversion failed. Saving will retry."}
                    </AlertDescription>
                  </Alert>
                )}
                {modelStatus.state === "none" && (
                  <Alert variant="warning">
                    <LuTriangleAlert />
                    <AlertDescription>
                      This item has no 3D model. Upload a STEP file on the
                      item's Model tab first.
                    </AlertDescription>
                  </Alert>
                )}
                <VStack spacing={1} className="w-full">
                  <Item
                    name="itemId"
                    label="Item"
                    type="Item"
                    replenishmentSystem="Make"
                    onChange={(selected) => {
                      checkModel(selected?.value ?? "");
                    }}
                  />
                  {modelStatus.state === "loading" && (
                    <p className="text-xs text-muted-foreground">
                      Checking for a 3D model…
                    </p>
                  )}
                  {modelStatus.state === "converted" && (
                    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <LuCircleCheck className="h-3.5 w-3.5 shrink-0" />
                      Model: {modelStatus.label}
                    </p>
                  )}
                </VStack>
              </VStack>
            </ModalDrawerBody>
            <ModalDrawerFooter>
              <HStack>
                <Submit isDisabled={isDisabled}>Save</Submit>
              </HStack>
            </ModalDrawerFooter>
          </ValidatedForm>
        </ModalDrawerContent>
      </ModalDrawer>
    </ModalDrawerProvider>
  );
};

export default AssemblyInstructionForm;
