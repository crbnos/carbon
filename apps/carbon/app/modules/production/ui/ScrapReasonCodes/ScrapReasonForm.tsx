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
  VStack,
  toast,
} from "@carbon/react";
import { useFetcher } from "@remix-run/react";
import type { PostgrestResponse } from "@supabase/supabase-js";
import { useEffect } from "react";
import type { z } from "zod";
import { CustomFormFields, Hidden, Input, Submit } from "~/components/Form";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import { scrapReasonValidator } from "../../production.models";

type ScrapReasonFormProps = {
  initialValues: z.infer<typeof scrapReasonValidator>;
  type?: "modal" | "drawer";
  open?: boolean;
  onClose: () => void;
};

const ScrapReasonForm = ({
  initialValues,
  open = true,
  type = "drawer",
  onClose,
}: ScrapReasonFormProps) => {
  const permissions = usePermissions();
  const fetcher = useFetcher<PostgrestResponse<{ id: string }>>();

  useEffect(() => {
    if (type !== "modal") return;

    if (fetcher.state === "loading" && fetcher.data?.data) {
      onClose?.();
      toast.success(`Created scrap reason`);
    } else if (fetcher.state === "idle" && fetcher.data?.error) {
      toast.error(
        `Failed to create scrap reason: ${fetcher.data.error.message}`
      );
    }
  }, [fetcher.data, fetcher.state, onClose, type]);

  const isEditing = initialValues.id !== undefined;
  const isDisabled = isEditing
    ? !permissions.can("update", "production")
    : !permissions.can("create", "production");

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
            validator={scrapReasonValidator}
            method="post"
            action={
              isEditing
                ? path.to.scrapReason(initialValues.id!)
                : path.to.newScrapReason
            }
            defaultValues={initialValues}
            fetcher={fetcher}
            className="flex flex-col h-full"
          >
            <ModalDrawerHeader>
              <ModalDrawerTitle>
                {isEditing ? "Edit" : "New"} Scrap Reason
              </ModalDrawerTitle>
            </ModalDrawerHeader>
            <ModalDrawerBody>
              <Hidden name="id" />
              <Hidden name="type" value={type} />
              <VStack spacing={4}>
                <Input name="name" label="Scrap Reason" />
                <CustomFormFields table="scrapReason" />
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

export default ScrapReasonForm;
