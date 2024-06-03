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
  CustomFormFields,
  Hidden,
  Input,
  Submit,
  TextArea,
} from "~/components/Form";
import { usePermissions } from "~/hooks";
import { partGroupValidator } from "~/modules/parts";
import { path } from "~/utils/path";

type PartGroupFormProps = {
  initialValues: z.infer<typeof partGroupValidator>;
  type?: "modal" | "drawer";
  open?: boolean;
  onClose: (data?: { id: string; name: string }) => void;
};

const PartGroupForm = ({
  initialValues,
  open = true,
  type = "drawer",
  onClose,
}: PartGroupFormProps) => {
  const permissions = usePermissions();
  const fetcher = useFetcher<PostgrestResponse<{ id: string; name: string }>>();

  const isEditing = initialValues.id !== undefined;
  const isDisabled = isEditing
    ? !permissions.can("update", "parts")
    : !permissions.can("create", "parts");

  useEffect(() => {
    if (type !== "modal") return;

    if (fetcher.state === "loading" && fetcher.data?.data) {
      onClose?.();
      toast.success(`Created part group`);
    } else if (fetcher.state === "idle" && fetcher.data?.error) {
      toast.error(`Failed to create part group: ${fetcher.data.error.message}`);
    }
  }, [fetcher.data, fetcher.state, onClose, type]);

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
            validator={partGroupValidator}
            method="post"
            action={
              isEditing
                ? path.to.partGroup(initialValues.id!)
                : path.to.newPartGroup
            }
            defaultValues={initialValues}
            fetcher={fetcher}
            className="flex flex-col h-full"
          >
            <ModalDrawerHeader>
              <ModalDrawerTitle>
                {isEditing ? "Edit" : "New"} Part Group
              </ModalDrawerTitle>
            </ModalDrawerHeader>
            <ModalDrawerBody>
              <Hidden name="id" />
              <Hidden name="type" value={type} />
              <VStack spacing={4}>
                <Input name="name" label="Name" />
                <TextArea name="description" label="Description" />
                <CustomFormFields table="partGroup" />
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

export default PartGroupForm;
