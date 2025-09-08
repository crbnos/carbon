import { ValidatedForm } from "@carbon/form";
import {
  CardDescription,
  CardTitle,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  HStack,
  VStack,
} from "@carbon/react";
import { getLocalTimeZone, startOfWeek, today } from "@internationalized/date";
import { useFetcher, useLoaderData } from "@remix-run/react";
import type { z } from "zod";
import { Hidden, Item, Location, Number, Submit } from "~/components/Form";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import { demandForecastsValidator } from "../../production.models";

type LoaderData = {
  periods?: Array<{ id: string; name: string }>;
  initialValues?: z.infer<typeof demandForecastsValidator>;
};

type DemandForecastsFormProps = {
  initialValues?: z.infer<typeof demandForecastsValidator>;
  isEditing?: boolean;
  onClose: () => void;
};

const DemandForecastsForm = ({
  initialValues: propInitialValues,
  isEditing = false,
  onClose,
}: DemandForecastsFormProps) => {
  const permissions = usePermissions();
  const fetcher = useFetcher<{ id: string }>();
  const loaderData = useLoaderData<LoaderData>();
  const periods = loaderData?.periods ?? [];
  const initialValues = loaderData?.initialValues ??
    propInitialValues ?? {
      itemId: "",
      locationId: "",
      ...Object.fromEntries(
        Array.from({ length: 52 }, (_, i) => [`week${i}`, 0])
      ),
    };

  const isDisabled = isEditing
    ? !permissions.can("update", "production")
    : !permissions.can("create", "production");

  // Generate week labels based on periods
  const startDate = startOfWeek(today(getLocalTimeZone()), "en-US");
  const weekLabels = Array.from({ length: 52 }, (_, i) => {
    const weekDate = startDate.add({ weeks: i });
    return `Week ${i + 1} (${weekDate.month}/${weekDate.day})`;
  });

  return (
    <Drawer
      open
      onOpenChange={(open) => {
        if (!open) onClose?.();
      }}
    >
      <DrawerContent>
        <ValidatedForm
          validator={demandForecastsValidator}
          method="post"
          action={
            isEditing
              ? path.to.demandForecast(
                  initialValues.itemId!,
                  initialValues.locationId!
                )
              : path.to.newDemandForecast
          }
          defaultValues={initialValues}
          fetcher={fetcher}
          className="flex flex-col h-full"
        >
          <DrawerHeader>
            <CardTitle>
              {isEditing ? "Edit" : "New"} Production Projection
            </CardTitle>
            <CardDescription>
              Set demand forecast values for each week
            </CardDescription>
          </DrawerHeader>
          <DrawerBody>
            <div>
              {/* Hidden fields for periods */}
              {periods?.map((period, index) => (
                <Hidden
                  key={period.id}
                  name={`periods[${index}]`}
                  value={period.id}
                />
              ))}
            </div>
            <VStack spacing={4}>
              <Item
                name="itemId"
                label="Item"
                type="Part"
                replenishmentSystem="Make"
                isReadOnly={isEditing}
              />
              <Location
                name="locationId"
                label="Location"
                isReadOnly={isEditing}
              />

              {weekLabels.map((label, index) => (
                <Number
                  key={index}
                  name={`week${index}`}
                  label={label}
                  minValue={0}
                />
              ))}
            </VStack>
          </DrawerBody>

          <DrawerFooter>
            <HStack className="justify-end">
              <Submit
                isLoading={fetcher.state !== "idle"}
                isDisabled={fetcher.state !== "idle" || isDisabled}
              >
                {isEditing ? "Update" : "Create"} Projection
              </Submit>
            </HStack>
          </DrawerFooter>
        </ValidatedForm>
      </DrawerContent>
    </Drawer>
  );
};

export default DemandForecastsForm;
