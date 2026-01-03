import { ValidatedForm } from "@carbon/form";
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
  toast,
  VStack
} from "@carbon/react";
import type { PostgrestResponse } from "@supabase/supabase-js";
import { useEffect } from "react";
import { useFetcher } from "react-router";
import type { z } from "zod/v3";
import { Enumerable } from "~/components/Enumerable";
import {
  CustomFormFields,
  Hidden,
  Input,
  Select,
  Submit
} from "~/components/Form";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import {
  failureModeValidator,
  maintenanceFailureModeType
} from "../../resources.models";

type FailureModeFormProps = {
  initialValues: z.infer<typeof failureModeValidator>;
  type?: "modal" | "drawer";
  open?: boolean;
  onClose: () => void;
};

const FailureModeForm = ({
  initialValues,
  open = true,
  type = "drawer",
  onClose
}: FailureModeFormProps) => {
  const permissions = usePermissions();
  const fetcher = useFetcher<PostgrestResponse<{ id: string }>>();

  useEffect(() => {
    if (type !== "modal") return;

    if (fetcher.state === "loading" && fetcher.data?.data) {
      onClose?.();
      toast.success(`Created failure mode`);
    } else if (fetcher.state === "idle" && fetcher.data?.error) {
      toast.error(
        `Failed to create failure mode: ${fetcher.data.error.message}`
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
            validator={failureModeValidator}
            method="post"
            action={
              isEditing
                ? path.to.failureMode(initialValues.id!)
                : path.to.newFailureMode
            }
            defaultValues={initialValues}
            fetcher={fetcher}
            className="flex flex-col h-full"
          >
            <ModalDrawerHeader>
              <ModalDrawerTitle>
                {isEditing ? "Edit" : "New"} Failure Mode
              </ModalDrawerTitle>
            </ModalDrawerHeader>
            <ModalDrawerBody>
              <Hidden name="id" />
              <Hidden name="formType" value={type} />
              <VStack spacing={4}>
                <Input name="name" label="Failure Mode" />
                <Select
                  name="type"
                  label="Type"
                  options={maintenanceFailureModeType.map((t) => ({
                    value: t,
                    label: <Enumerable value={t} />
                  }))}
                />
                <CustomFormFields table="maintenanceFailureMode" />
              </VStack>
            </ModalDrawerBody>
            <ModalDrawerFooter>
              <HStack>
                <Submit isDisabled={isDisabled}>Save</Submit>
                <Button size="md" variant="solid" onClick={() => onClose()}>
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

export default FailureModeForm;
