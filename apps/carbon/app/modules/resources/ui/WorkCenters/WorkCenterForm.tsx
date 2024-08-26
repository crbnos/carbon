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
  Location,
  Number,
  Processes,
  StandardFactor,
  Submit,
  TextArea,
} from "~/components/Form";
import { usePermissions } from "~/hooks";
import { workCenterValidator } from "~/modules/resources";
import { path } from "~/utils/path";

type WorkCenterFormProps = {
  initialValues: z.infer<typeof workCenterValidator>;
  type?: "modal" | "drawer";
  open?: boolean;
  showProcesses?: boolean;
  onClose: () => void;
};

const WorkCenterForm = ({
  initialValues,
  open = true,
  type = "drawer",
  showProcesses = true,
  onClose,
}: WorkCenterFormProps) => {
  const permissions = usePermissions();
  const fetcher = useFetcher<PostgrestResponse<{ id: string }>>();

  useEffect(() => {
    if (type !== "modal") return;

    if (fetcher.state === "loading" && fetcher.data?.data) {
      onClose?.();
      toast.success(`Created work center`);
    } else if (fetcher.state === "idle" && fetcher.data?.error) {
      toast.error(
        `Failed to create work center: ${fetcher.data.error.message}`
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
        onOpenChange={(isOpen) => {
          if (!isOpen) onClose?.();
        }}
      >
        <ModalDrawerContent>
          <ValidatedForm
            validator={workCenterValidator}
            method="post"
            action={
              isEditing
                ? path.to.workCenter(initialValues.id!)
                : path.to.newWorkCenter
            }
            defaultValues={initialValues}
            fetcher={fetcher}
            className="flex flex-col h-full"
          >
            <ModalDrawerHeader>
              <ModalDrawerTitle>
                {isEditing ? "Edit" : "New"} Work Center
              </ModalDrawerTitle>
            </ModalDrawerHeader>
            <ModalDrawerBody>
              <Hidden name="id" />
              <Hidden name="type" value={type} />
              <VStack spacing={4}>
                <Input name="name" label="Name" />
                {showProcesses && (
                  <Processes name="processes" label="Processes" />
                )}
                <TextArea name="description" label="Description" />
                <Location name="locationId" label="Location" />

                <Number
                  name="laborRate"
                  label="Labor Rate (Hourly)"
                  formatOptions={{
                    style: "currency",
                    currency: "USD",
                  }}
                />
                <Number
                  name="machineRate"
                  label="Machine Rate (Hourly)"
                  formatOptions={{
                    style: "currency",
                    currency: "USD",
                  }}
                />
                <Number
                  name="overheadRate"
                  label="Overhead Rate (Hourly)"
                  formatOptions={{
                    style: "currency",
                    currency: "USD",
                  }}
                />

                <StandardFactor
                  name="defaultStandardFactor"
                  label="Default Unit"
                  value={initialValues.defaultStandardFactor}
                />
                <Ability
                  name="requiredAbilityId"
                  label="Required Ability"
                  isClearable
                />
                <CustomFormFields table="workCenter" />
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

export default WorkCenterForm;
