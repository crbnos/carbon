import { DatePicker, Select, ValidatedForm } from "@carbon/form";
import {
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  HStack,
  IconButton,
  ModalDrawer,
  ModalDrawerBody,
  ModalDrawerContent,
  ModalDrawerFooter,
  ModalDrawerHeader,
  ModalDrawerProvider,
  ModalDrawerTitle,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  useDisclosure,
  VStack,
} from "@carbon/react";
import { formatRelativeTime } from "@carbon/utils";
import { getLocalTimeZone, parseDate, today } from "@internationalized/date";
import { Await, Link, useFetcher } from "@remix-run/react";
import type { PostgrestResponse } from "@supabase/supabase-js";
import { Suspense, useState } from "react";
import {
  LuCalendar,
  LuCircleGauge,
  LuCirclePlus,
  LuEllipsisVertical,
} from "react-icons/lu";
import type { z } from "zod";
import { EmployeeAvatar, Empty } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import {
  CustomFormFields,
  Hidden,
  Input,
  Location,
  NumberControlled,
  SequenceOrCustomId,
  Shelf,
  Submit,
  Supplier,
} from "~/components/Form";
import { usePermissions } from "~/hooks";
import type { ListItem } from "~/types";
import { path } from "~/utils/path";
import { gaugeRole, gaugeValidator } from "../../quality.models";
import type { GaugeCalibrationRecord } from "../../types";
import GaugeCalibrationRecordForm from "../Calibrations/GaugeCalibrationRecordForm";
import { GaugeRole } from "./GaugeStatus";

type GaugeFormValues = z.infer<typeof gaugeValidator>;

type GaugeFormProps = {
  initialValues: GaugeFormValues;
  gaugeTypes: ListItem[];
  records?: Promise<PostgrestResponse<GaugeCalibrationRecord>>;
  type?: "modal" | "drawer";
  open?: boolean;
  onClose?: () => void;
};

const GaugeForm = ({
  initialValues,
  gaugeTypes,
  records,
  open = true,
  type = "drawer",
  onClose,
}: GaugeFormProps) => {
  const permissions = usePermissions();
  const fetcher = useFetcher<{}>();
  const isEditing = initialValues.id !== undefined;
  const isDisabled = isEditing
    ? !permissions.can("update", "quality")
    : !permissions.can("create", "quality");

  const [calibrationInterval, setCalibrationInterval] = useState({
    lastCalibrationDate: initialValues.lastCalibrationDate,
    nextCalibrationDate: initialValues.nextCalibrationDate,
    calibrationIntervalInMonths: initialValues.calibrationIntervalInMonths ?? 6,
  });

  const [activeTab, setActiveTab] = useState<string>("gauge");
  const newRecordDisclosure = useDisclosure();

  return (
    <>
      <ModalDrawerProvider type={type}>
        <ModalDrawer
          open={open}
          onOpenChange={(open) => {
            if (!open && onClose) onClose();
          }}
        >
          <ModalDrawerContent size="lg">
            <Tabs
              value={activeTab}
              onValueChange={setActiveTab}
              className="flex flex-col h-full"
            >
              <ValidatedForm
                method="post"
                validator={gaugeValidator}
                defaultValues={initialValues}
                fetcher={fetcher}
                action={
                  isEditing
                    ? path.to.gauge(initialValues.id!)
                    : path.to.newGauge
                }
                className="flex flex-col h-full"
              >
                <ModalDrawerHeader className="flex flex-col gap-4">
                  <HStack className="w-full justify-between pr-8">
                    <ModalDrawerTitle>
                      {isEditing ? `${initialValues.gaugeId}` : "New Gauge"}
                    </ModalDrawerTitle>

                    {isEditing && (
                      <div>
                        <TabsList>
                          <TabsTrigger value="gauge">Details</TabsTrigger>
                          <TabsTrigger value="records">
                            Calibration Records
                          </TabsTrigger>
                        </TabsList>
                      </div>
                    )}
                  </HStack>
                </ModalDrawerHeader>
                <ModalDrawerBody className="w-full">
                  <Hidden name="id" />
                  <Hidden name="type" value={type} />

                  {isEditing ? (
                    <>
                      <TabsContent value="gauge" className="w-full">
                        <GaugeFormContent
                          isEditing={isEditing}
                          gaugeTypes={gaugeTypes}
                          initialValues={initialValues}
                          calibrationInterval={calibrationInterval}
                          setCalibrationInterval={setCalibrationInterval}
                        />
                      </TabsContent>
                      <TabsContent
                        value="records"
                        className="w-full flex flex-col gap-4"
                      >
                        <div className="flex justify-end">
                          <Button
                            leftIcon={<LuCirclePlus />}
                            onClick={newRecordDisclosure.onOpen}
                          >
                            Add Calibration Record
                          </Button>
                        </div>
                        {records && (
                          <Suspense fallback={null}>
                            <Await resolve={records}>
                              {(resolvedRecords) => (
                                <VStack spacing={4} className="w-full">
                                  {Array.isArray(resolvedRecords.data) &&
                                  resolvedRecords.data.length > 0 ? (
                                    <div className="border rounded-lg w-full">
                                      {resolvedRecords.data.map(
                                        (record, index) => {
                                          const isUpdated =
                                            record.updatedBy !== null;
                                          const person = isUpdated
                                            ? record.updatedBy
                                            : record.createdBy;
                                          const date = isUpdated
                                            ? record.updatedAt
                                            : record.createdAt;
                                          return (
                                            <div
                                              key={record.id}
                                              className={cn(
                                                "border-b p-6",
                                                index ===
                                                  (resolvedRecords.data
                                                    ?.length ?? 0) -
                                                    1 && "border-none"
                                              )}
                                            >
                                              <div className="flex flex-1 justify-between items-center w-full">
                                                <HStack
                                                  spacing={4}
                                                  className="w-1/2"
                                                >
                                                  <HStack
                                                    spacing={4}
                                                    className="flex-1"
                                                  >
                                                    <div
                                                      className={cn(
                                                        "rounded-full flex items-center justify-center p-2",
                                                        record.inspectionStatus ===
                                                          "Pass"
                                                          ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-400"
                                                          : "bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-400"
                                                      )}
                                                    >
                                                      <LuCircleGauge className="size-4" />
                                                    </div>
                                                    <VStack spacing={0}>
                                                      <p className="text-foreground text-sm font-medium">
                                                        {
                                                          record.inspectionStatus
                                                        }
                                                      </p>
                                                      <span className="text-xs text-muted-foreground">
                                                        Calibration Record
                                                      </span>
                                                    </VStack>
                                                  </HStack>
                                                </HStack>
                                                <div className="flex items-center justify-end gap-2">
                                                  <HStack spacing={2}>
                                                    <span className="text-xs text-muted-foreground">
                                                      {date
                                                        ? isUpdated
                                                          ? "Updated"
                                                          : "Created"
                                                        : null}{" "}
                                                      {date
                                                        ? formatRelativeTime(
                                                            date
                                                          )
                                                        : null}
                                                    </span>
                                                    <EmployeeAvatar
                                                      employeeId={person}
                                                      withName={false}
                                                    />
                                                  </HStack>
                                                  <DropdownMenu>
                                                    <DropdownMenuTrigger
                                                      asChild
                                                    >
                                                      <IconButton
                                                        aria-label="Open menu"
                                                        icon={
                                                          <LuEllipsisVertical />
                                                        }
                                                        variant="ghost"
                                                      />
                                                    </DropdownMenuTrigger>
                                                    <DropdownMenuContent align="end">
                                                      <DropdownMenuItem asChild>
                                                        <Link
                                                          to={path.to.gaugeCalibrationRecord(
                                                            record.id!
                                                          )}
                                                        >
                                                          View
                                                        </Link>
                                                      </DropdownMenuItem>
                                                    </DropdownMenuContent>
                                                  </DropdownMenu>
                                                </div>
                                              </div>
                                            </div>
                                          );
                                        }
                                      )}
                                    </div>
                                  ) : (
                                    <div className="py-16 w-full">
                                      <Empty title="No calibration records found" />
                                    </div>
                                  )}
                                </VStack>
                              )}
                            </Await>
                          </Suspense>
                        )}
                      </TabsContent>
                    </>
                  ) : (
                    <GaugeFormContent
                      isEditing={isEditing}
                      gaugeTypes={gaugeTypes}
                      initialValues={initialValues}
                      calibrationInterval={calibrationInterval}
                      setCalibrationInterval={setCalibrationInterval}
                    />
                  )}
                </ModalDrawerBody>
                <ModalDrawerFooter>
                  <HStack>
                    <Submit isDisabled={isDisabled}>Save</Submit>
                    {onClose && (
                      <Button size="md" variant="solid" onClick={onClose}>
                        Cancel
                      </Button>
                    )}
                  </HStack>
                </ModalDrawerFooter>
              </ValidatedForm>
            </Tabs>
          </ModalDrawerContent>
        </ModalDrawer>
      </ModalDrawerProvider>
      {newRecordDisclosure.isOpen && (
        <GaugeCalibrationRecordForm
          initialValues={{
            id: undefined,
            gaugeId: initialValues.id!,
            dateCalibrated: today(getLocalTimeZone()).toString(),
            requiresAction: false,
            requiresAdjustment: false,
            requiresRepair: false,
            notes: "{}",
          }}
          type="drawer"
          open={newRecordDisclosure.isOpen}
          onClose={newRecordDisclosure.onClose}
        />
      )}
    </>
  );
};

function GaugeFormContent({
  isEditing,
  gaugeTypes,
  initialValues,
  calibrationInterval,
  setCalibrationInterval,
}: {
  isEditing: boolean;
  gaugeTypes: ListItem[];
  initialValues: GaugeFormValues;
  calibrationInterval: {
    lastCalibrationDate: string | undefined;
    nextCalibrationDate: string | undefined;
    calibrationIntervalInMonths: number;
  };
  setCalibrationInterval: React.Dispatch<
    React.SetStateAction<{
      lastCalibrationDate: string | undefined;
      nextCalibrationDate: string | undefined;
      calibrationIntervalInMonths: number;
    }>
  >;
}) {
  return (
    <VStack spacing={4}>
      <div className="grid w-full gap-4 grid-cols-1 md:grid-cols-2">
        {isEditing ? (
          <Input name="gaugeId" label="Gauge ID" isReadOnly />
        ) : (
          <SequenceOrCustomId name="gaugeId" label="Gauge ID" table="gauge" />
        )}
        <Input name="description" label="Description" />
        <Select
          name="gaugeTypeId"
          label="Gauge Type"
          options={gaugeTypes.map((type) => ({
            label: <Enumerable value={type.name} />,
            value: type.id,
          }))}
        />
        <Supplier name="supplierId" label="Supplier" />
        <Input name="modelNumber" label="Model Number" />
        <Input name="serialNumber" label="Serial Number" />
        {/* <Select
          name="gaugeCalibrationStatus"
          label="Calibration Status"
          options={gaugeCalibrationStatus.map((status) => ({
            label: <GaugeCalibrationStatus status={status} />,
            value: status,
          }))}
        /> */}
        <Select
          name="gaugeRole"
          label="Role"
          options={gaugeRole.map((role) => ({
            label: <GaugeRole role={role} />,
            value: role,
          }))}
        />
        <DatePicker name="dateAcquired" label="Date Acquired" />
        {/* <Select
          name="gaugeStatus"
          label="Status"
          options={gaugeStatus.map((status) => ({
            label: <GaugeStatus status={status} />,
            value: status,
          }))}
        /> */}
        <DatePicker
          name="lastCalibrationDate"
          label="Last Calibration Date"
          value={calibrationInterval.lastCalibrationDate}
          onChange={(value) => {
            setCalibrationInterval({
              ...calibrationInterval,
              lastCalibrationDate: value?.toString(),
              nextCalibrationDate: value
                ? parseDate(value?.toString())
                    .add({
                      months: calibrationInterval.calibrationIntervalInMonths,
                    })
                    .toString()
                : undefined,
            });
          }}
        />
        <DatePicker
          name="nextCalibrationDate"
          label="Next Calibration Date"
          value={calibrationInterval.nextCalibrationDate}
          onChange={(value) => {
            setCalibrationInterval({
              ...calibrationInterval,
              nextCalibrationDate: value?.toString(),
            });
          }}
        />
        <Location name="locationId" label="Location" />
        <Shelf
          name="shelfId"
          label="Shelf"
          locationId={initialValues.locationId}
        />
        <CustomFormFields table="gauge" />
      </div>
      <div className="border bg-muted/30 rounded-lg p-4 relative w-full">
        <LuCalendar className="absolute top-2 right-4 text-muted-foreground" />
        <NumberControlled
          name="calibrationIntervalInMonths"
          label="Calibration Interval (Months)"
          value={calibrationInterval.calibrationIntervalInMonths}
          onChange={(value) => {
            setCalibrationInterval({
              ...calibrationInterval,
              calibrationIntervalInMonths: value,
              nextCalibrationDate: calibrationInterval.lastCalibrationDate
                ? parseDate(calibrationInterval.lastCalibrationDate)
                    .add({
                      months: value,
                    })
                    .toString()
                : undefined,
            });
          }}
        />
      </div>
    </VStack>
  );
}

export default GaugeForm;
