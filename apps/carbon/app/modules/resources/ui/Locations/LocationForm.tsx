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
import {
  CustomFormFields,
  Hidden,
  Input,
  Submit,
  Timezone,
} from "~/components/Form";
import Country from "~/components/Form/Country";
import { usePermissions } from "~/hooks";
import { locationValidator } from "~/modules/resources";
import { path } from "~/utils/path";

type LocationFormProps = {
  initialValues: z.infer<typeof locationValidator>;
  type?: "modal" | "drawer";
  open?: boolean;
  onClose: () => void;
};

const LocationForm = ({
  initialValues,
  open = true,
  type = "drawer",
  onClose,
}: LocationFormProps) => {
  const permissions = usePermissions();
  const fetcher = useFetcher<PostgrestResponse<{ id: string }>>();

  useEffect(() => {
    if (type !== "modal") return;

    if (fetcher.state === "loading" && fetcher.data?.data) {
      onClose?.();
      toast.success(`Created location`);
    } else if (fetcher.state === "idle" && fetcher.data?.error) {
      toast.error(`Failed to create location: ${fetcher.data.error.message}`);
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
            validator={locationValidator}
            method="post"
            action={
              isEditing
                ? path.to.location(initialValues.id!)
                : path.to.newLocation
            }
            defaultValues={initialValues}
            fetcher={fetcher}
            className="flex flex-col h-full"
          >
            <ModalDrawerHeader>
              <ModalDrawerTitle>
                {isEditing ? "Edit" : "New"} Location
              </ModalDrawerTitle>
            </ModalDrawerHeader>
            <ModalDrawerBody>
              <Hidden name="id" />
              <Hidden name="type" value={type} />
              <VStack spacing={4}>
                <Input name="name" label="Location Name" />
                <Input name="addressLine1" label="Address Line 1" />
                <Input name="addressLine2" label="Address Line 2" />
                <Input name="city" label="City" />
                <Input name="state" label="State" />
                <Input name="postalCode" label="Postal Code" />
                <Country />
                <Timezone name="timezone" label="Timezone" />
                {/* <Number name="latitude" label="Latitude" minValue={-90} maxValue={90} />
              <Number name="longitude" label="Longitude" minVale={-180} maxValue={180} /> */}
                <CustomFormFields table="location" />
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

export default LocationForm;
