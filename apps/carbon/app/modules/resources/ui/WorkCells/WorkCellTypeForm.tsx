import {
  Button,
  HStack,
  ModalDrawer,
  ModalDrawerBody,
  ModalDrawerContent,
  ModalDrawerFooter,
  ModalDrawerHeader,
  ModalDrawerProvider,
  ModalDrawerTitle,
  VStack,
  toast,
} from "@carbon/react";
import { ValidatedForm } from "@carbon/remix-validated-form";
import { useFetcher } from "@remix-run/react";
import type { PostgrestResponse } from "@supabase/supabase-js";
import { useEffect } from "react";
import type { z } from "zod";
import {
  Ability,
  CustomFormFields,
  Hidden,
  Input,
  Number,
  StandardFactor,
  Submit,
  TextArea,
} from "~/components/Form";
import { usePermissions } from "~/hooks";
import { workCellTypeValidator } from "~/modules/resources";
import { path } from "~/utils/path";

type WorkCellTypeFormProps = {
  initialValues: z.infer<typeof workCellTypeValidator>;
  type?: "modal" | "drawer";
  open?: boolean;
  onClose: () => void;
};

const WorkCellTypeForm = ({
  initialValues,
  open = true,
  type = "drawer",
  onClose,
}: WorkCellTypeFormProps) => {
  const permissions = usePermissions();
  const fetcher = useFetcher<PostgrestResponse<{ id: string }>>();

  useEffect(() => {
    if (type !== "modal") return;

    if (fetcher.state === "loading" && fetcher.data?.data) {
      onClose?.();
      toast.success(`Created work cell type`);
    } else if (fetcher.state === "idle" && fetcher.data?.error) {
      toast.error(
        `Failed to create work cell type: ${fetcher.data.error.message}`
      );
    }
  }, [fetcher.data, fetcher.state, onClose, type]);

  const isEditing = initialValues.id !== undefined;
  const isDisabled = isEditing
    ? !permissions.can("update", "resources")
    : !permissions.can("create", "resources");

  return (
    <ModalDrawerProvider type={type}>
      <ModalDrawer
        open={open}
        onOpenChange={(open) => {
          if (!open) onClose?.();
        }}
      >
        <ModalDrawerContent>
          <ValidatedForm
            validator={workCellTypeValidator}
            method="post"
            action={
              isEditing
                ? path.to.workCellType(initialValues.id!)
                : path.to.newWorkCellType
            }
            defaultValues={initialValues}
            fetcher={fetcher}
            className="flex flex-col h-full"
          >
            <ModalDrawerHeader>
              <ModalDrawerTitle>
                {isEditing ? "Edit" : "New"} Work Cell Type
              </ModalDrawerTitle>
            </ModalDrawerHeader>
            <ModalDrawerBody>
              <Hidden name="id" />
              <Hidden name="type" value={type} />
              <VStack spacing={4}>
                <Input name="name" label="Name" />
                <TextArea name="description" label="Description" />
                <Ability
                  name="requiredAbility"
                  label="Required Ability"
                  isClearable
                />
                <Number name="quotingRate" label="Quoting Rate" />
                <Number name="laborRate" label="Labor Rate" />
                <Number name="overheadRate" label="Overhead Rate" />
                <StandardFactor
                  name="defaultStandardFactor"
                  label="Default Standard Factor"
                  value={initialValues.defaultStandardFactor}
                />
                <CustomFormFields table="workCellType" />
              </VStack>
            </ModalDrawerBody>
            <ModalDrawerFooter>
              <HStack>
                <Submit isDisabled={isDisabled}>Save</Submit>
                <Button size="md" variant="solid" onClick={() => onClose?.()}>
                  Cancel
                </Button>
              </HStack>
            </ModalDrawerFooter>
          </ValidatedForm>
        </ModalDrawerContent>
      </ModalDrawer>
    </ModalDrawerProvider>
  );
};

export default WorkCellTypeForm;
