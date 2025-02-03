import { Boolean, Combobox, Input, ValidatedForm } from "@carbon/form";
import {
  Button,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  FormControl,
  FormLabel,
  HStack,
  Separator,
  VStack,
  toast,
  useMount,
} from "@carbon/react";
import { useFetcher } from "@remix-run/react";
import type { PostgrestResponse } from "@supabase/supabase-js";
import { useEffect } from "react";
import type { z } from "zod";
import { Hidden, Submit } from "~/components/Form";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import { webhookValidator } from "../../settings.models";
import type { getWebhookTables } from "../../settings.service";

type WebhookFormProps = {
  initialValues: z.infer<typeof webhookValidator>;
  type?: "modal" | "drawer";
  open?: boolean;
  onClose: (data?: { id: string; name: string }) => void;
};

const WebhookForm = ({
  initialValues,
  open = true,
  onClose,
}: WebhookFormProps) => {
  const permissions = usePermissions();
  const fetcher = useFetcher<PostgrestResponse<{ id: string }>>();

  const tables = useWebhookTables();

  useEffect(() => {
    if (fetcher.state === "loading" && fetcher.data?.data) {
      onClose?.();
      toast.success(`Created unit of measure`);
    } else if (fetcher.state === "idle" && fetcher.data?.error) {
      toast.error(
        `Failed to create unit of measure: ${fetcher.data.error.message}`
      );
    }
  }, [fetcher.data, fetcher.state, onClose]);

  const isEditing = initialValues.id !== undefined;
  const isDisabled = isEditing
    ? !permissions.can("update", "parts")
    : !permissions.can("create", "parts");

  return (
    <Drawer
      open={open}
      onOpenChange={(open) => {
        if (!open) onClose?.();
      }}
    >
      <DrawerContent size="sm">
        <ValidatedForm
          validator={webhookValidator}
          method="post"
          action={
            isEditing ? path.to.webhook(initialValues.id!) : path.to.newWebhook
          }
          defaultValues={initialValues}
          fetcher={fetcher}
          className="flex flex-col h-full"
        >
          <DrawerHeader>
            <DrawerTitle>{isEditing ? "Edit" : "New"} Webhook</DrawerTitle>
          </DrawerHeader>
          <DrawerBody>
            <Hidden name="id" />

            <VStack spacing={4}>
              <Input
                name="name"
                label="Name"
                helperText="This is a unique identifier for the webhook"
              />
              <Input
                name="url"
                label="Webhook URL"
                helperText="The URL of the webhook"
              />
              <Combobox name="table" label="Table" options={tables} />
              <FormControl>
                <FormLabel>Notifications</FormLabel>
                <VStack>
                  <Boolean name="onInsert" description="Insert" />
                  <Boolean name="onUpdate" description="Update" />
                  <Boolean name="onDelete" description="Delete" />
                </VStack>
              </FormControl>

              <Separator />

              <Boolean name="active" label="Active" />
            </VStack>
          </DrawerBody>
          <DrawerFooter>
            <HStack>
              <Submit isDisabled={isDisabled}>Save</Submit>
              <Button size="md" variant="solid" onClick={() => onClose()}>
                Cancel
              </Button>
            </HStack>
          </DrawerFooter>
        </ValidatedForm>
      </DrawerContent>
    </Drawer>
  );
};

export default WebhookForm;

export const useWebhookTables = () => {
  const tablesFetcher =
    useFetcher<Awaited<ReturnType<typeof getWebhookTables>>>();

  useMount(() => {
    tablesFetcher.load(path.to.api.webhookTables);
  });

  const tables = tablesFetcher.data?.data ?? [];

  const options = tables.map((t) => ({
    value: t.table,
    label: t.name,
  }));

  return options;
};
