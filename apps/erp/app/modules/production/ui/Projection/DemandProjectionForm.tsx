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
  VStack
} from "@carbon/react";
import { getLocalTimeZone, startOfWeek, today } from "@internationalized/date";
import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { useFetcher, useLoaderData } from "react-router";
import type { z } from "zod";
import { Hidden, Item, Location, Number, Submit } from "~/components/Form";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import { demandProjectionValidator } from "../../production.models";

type LoaderData = {
  periods?: Array<{ id: string; name: string }>;
  initialValues?: z.infer<typeof demandProjectionValidator>;
};

type DemandProjectionsFormProps = {
  initialValues?: z.infer<typeof demandProjectionValidator>;
  isEditing?: boolean;
  onClose: () => void;
};

const DemandProjectionsForm = ({
  initialValues: propInitialValues,
  isEditing = false,
  onClose
}: DemandProjectionsFormProps) => {
  const permissions = usePermissions();
  const { t, i18n } = useLingui();
  const fetcher = useFetcher<{ id: string }>();
  const loaderData = useLoaderData<LoaderData>();
  const periods = loaderData?.periods ?? [];
  const initialValues = loaderData?.initialValues ??
    propInitialValues ?? {
      itemId: "",
      locationId: "",
      ...Object.fromEntries(
        Array.from({ length: 52 }, (_, i) => [`week${i}`, 0])
      )
    };

  const isDisabled = isEditing
    ? !permissions.can("update", "production")
    : !permissions.can("create", "production");

  const timeZone = getLocalTimeZone();
  const startDate = startOfWeek(today(timeZone), "en-US");
  const weekLabels = Array.from({ length: 52 }, (_, i) => {
    const weekDate = startDate.add({ weeks: i }).toDate(timeZone);
    const formattedDate = i18n.date(weekDate, {
      month: "numeric",
      day: "numeric"
    });
    return i18n._(msg`Week ${i + 1} (${formattedDate})`);
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
          validator={demandProjectionValidator}
          method="post"
          action={
            isEditing
              ? path.to.demandProjection(
                  initialValues.itemId!,
                  initialValues.locationId!
                )
              : path.to.newDemandProjection
          }
          defaultValues={initialValues}
          fetcher={fetcher}
          className="flex flex-col h-full"
        >
          <DrawerHeader>
            <CardTitle>
              {isEditing
                ? t`Edit Production Projection`
                : t`New Production Projection`}
            </CardTitle>
            <CardDescription>
              {t`Set demand projection values for each week`}
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
                label={t`Item`}
                type="Part"
                replenishmentSystem="Make"
                isReadOnly={isEditing}
                locationId={initialValues.locationId || undefined}
              />
              <Location
                name="locationId"
                label={t`Location`}
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
                {isEditing ? t`Update Projection` : t`Create Projection`}
              </Submit>
            </HStack>
          </DrawerFooter>
        </ValidatedForm>
      </DrawerContent>
    </Drawer>
  );
};

export default DemandProjectionsForm;
