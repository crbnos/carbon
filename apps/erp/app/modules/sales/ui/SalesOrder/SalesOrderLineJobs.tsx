import { ValidatedForm } from "@carbon/form";
import {
  Badge,
  Button,
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
  cn,
  HStack,
  IconButton,
  Loading,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  Progress,
  toast,
  useDisclosure,
  useMount,
  VStack,
} from "@carbon/react";
import { useFetcher, useNavigate, useParams } from "@remix-run/react";
import { useMemo, useState } from "react";
import {
  LuChevronDown,
  LuChevronRight,
  LuCirclePlay,
  LuCirclePlus,
  LuHardHat,
  LuSettings2,
} from "react-icons/lu";
import { Assignee, Empty, Hyperlink, TimeTypeIcon } from "~/components";
import {
  DatePicker,
  Hidden,
  Location,
  NumberControlled,
  Select,
  SequenceOrCustomId,
  Submit,
} from "~/components/Form";
import { usePermissions } from "~/hooks";

import { useCarbon } from "@carbon/auth";
import {
  getLocalTimeZone,
  isSameDay,
  parseDate,
  today,
} from "@internationalized/date";
import { flushSync } from "react-dom";
import { SupplierProcessPreview } from "~/components/Form/SupplierProcess";
import {
  deadlineTypes,
  salesOrderToJobValidator,
} from "~/modules/production/production.models";
import type { Job, JobOperation } from "~/modules/production/types";
import { getDeadlineIcon } from "~/modules/production/ui/Jobs/Deadline";
import { JobStartModal } from "~/modules/production/ui/Jobs/JobHeader";
import { JobOperationStatus } from "~/modules/production/ui/Jobs/JobOperationStatus";
import JobStatus from "~/modules/production/ui/Jobs/JobStatus";
import { path } from "~/utils/path";
import type {
  Opportunity,
  SalesOrder,
  SalesOrderJob,
  SalesOrderLine,
} from "../../types";

type SalesOrderLineJobsProps = {
  salesOrder: SalesOrder;
  line: SalesOrderLine;
  opportunity: Opportunity;
  jobs: Job[];
  itemReplenishment: { lotSize: number | null; scrapPercentage: number | null };
};

export function SalesOrderLineJobs({
  salesOrder,
  line,
  opportunity,
  jobs,
  itemReplenishment,
}: SalesOrderLineJobsProps) {
  const { orderId, lineId } = useParams();
  if (!orderId) throw new Error("orderId not found");
  if (!lineId) throw new Error("lineId not found");

  const newJobDisclosure = useDisclosure();
  const hasJobs = jobs.length > 0;

  const scrapPercentage = itemReplenishment.scrapPercentage ?? 0;
  const totalJobQuantity = jobs.reduce(
    (sum, job) => sum + (job.quantity ?? 0),
    0
  );
  const quantityRequired = (line.saleQuantity ?? 0) - totalJobQuantity;
  const [quantities, setQuantities] = useState<{
    quantity: number;
    scrapQuantity: number;
  }>(() => {
    const quantity = itemReplenishment.lotSize
      ? Math.min(quantityRequired, itemReplenishment.lotSize)
      : quantityRequired;
    return {
      quantity,
      scrapQuantity: Math.ceil(quantity * (scrapPercentage / 100)),
    };
  });

  return (
    <>
      <Card>
        <HStack className="w-full justify-between">
          <CardHeader>
            <CardTitle>Jobs</CardTitle>
          </CardHeader>
          <CardAction>
            {hasJobs && (
              <Button
                leftIcon={<LuHardHat />}
                onClick={newJobDisclosure.onOpen}
              >
                Make to Order
              </Button>
            )}
          </CardAction>
        </HStack>

        <CardContent>
          {jobs.length > 0 ? (
            <div className="border rounded-lg">
              {jobs
                .sort((a, b) => (a.jobId ?? "").localeCompare(b.jobId ?? ""))
                .map((job, index) => (
                  <div
                    key={job.id}
                    className={cn(
                      "border-b p-6",
                      index === jobs.length - 1 && "border-b-0"
                    )}
                  >
                    <SalesOrderJobItem job={job as SalesOrderJob} />
                  </div>
                ))}
            </div>
          ) : (
            <Empty className="pb-12">
              <Button
                leftIcon={<LuCirclePlus />}
                onClick={newJobDisclosure.onOpen}
              >
                Make to Order
              </Button>
            </Empty>
          )}
        </CardContent>
      </Card>
      {newJobDisclosure.isOpen && (
        <Modal
          open
          onOpenChange={(open) => {
            if (!open) newJobDisclosure.onClose();
          }}
        >
          <ModalContent size="large">
            <ValidatedForm
              validator={salesOrderToJobValidator}
              method="post"
              action={path.to.salesOrderLineToJob(orderId, lineId)}
              defaultValues={{
                customerId: salesOrder.customerId ?? undefined,
                deadlineType: "Hard Deadline",
                dueDate: line.promisedDate ?? "",
                itemId: line.itemId ?? undefined,
                locationId: line.locationId ?? "",
                modelUploadId: line.modelUploadId ?? undefined,
                quantity: line.saleQuantity ?? undefined,
                quoteId: opportunity.quotes[0]?.id ?? undefined,
                quoteLineId: opportunity.quotes[0]?.id ? lineId : undefined,
                salesOrderId: opportunity.salesOrders[0]?.id ?? undefined,
                salesOrderLineId: lineId,
                scrapQuantity: 0,
                unitOfMeasureCode: line.unitOfMeasureCode ?? undefined,
              }}
              className="flex flex-col h-full"
              onSubmit={newJobDisclosure.onClose}
            >
              <ModalHeader>
                <ModalTitle>Convert Line to Job</ModalTitle>
                <ModalDescription>
                  Create a new production job to fulfill the sales order
                </ModalDescription>
              </ModalHeader>
              <ModalBody>
                <Hidden name="modelUploadId" />
                <Hidden name="customerId" />
                <Hidden name="itemId" />
                <Hidden name="salesOrderId" />
                <Hidden name="salesOrderLineId" />
                <Hidden name="quoteId" />
                <Hidden name="quoteLineId" />
                <Hidden name="unitOfMeasureCode" />
                <div className="grid w-full gap-x-8 gap-y-4 grid-cols-1 md:grid-cols-2">
                  <SequenceOrCustomId name="jobId" label="Job ID" table="job" />
                  <Location name="locationId" label="Location" />
                  <NumberControlled
                    name="quantity"
                    label="Quantity"
                    value={quantities.quantity}
                    onChange={(value) => {
                      setQuantities((prev) => ({
                        ...prev,
                        quantity: value,
                        scrapQuantity: Math.ceil(value * scrapPercentage),
                      }));
                    }}
                    minValue={0}
                  />
                  <NumberControlled
                    name="scrapQuantity"
                    label="Scrap Quantity"
                    value={quantities.scrapQuantity}
                    onChange={(value) =>
                      setQuantities((prev) => ({
                        ...prev,
                        scrapQuantity: value,
                      }))
                    }
                    minValue={0}
                  />
                  <DatePicker name="dueDate" label="Due Date" />
                  <Select
                    name="deadlineType"
                    label="Deadline Type"
                    options={deadlineTypes.map((d) => ({
                      value: d,
                      label: (
                        <div className="flex gap-1 items-center">
                          {getDeadlineIcon(d)}
                          <span>{d}</span>
                        </div>
                      ),
                    }))}
                  />
                </div>
              </ModalBody>
              <ModalFooter>
                <Button variant="secondary" onClick={newJobDisclosure.onClose}>
                  Cancel
                </Button>
                <Submit>Create</Submit>
              </ModalFooter>
            </ValidatedForm>
          </ModalContent>
        </Modal>
      )}
    </>
  );
}

export function SalesOrderJobItem({ job }: { job: SalesOrderJob }) {
  const disclosure = useDisclosure();
  const permissions = usePermissions();
  const releaseModal = useDisclosure();
  const statusFetcher = useFetcher<{}>();
  const todaysDate = useMemo(() => today(getLocalTimeZone()), []);

  return (
    <VStack>
      <HStack className="w-full justify-between">
        <HStack>
          <Hyperlink to={path.to.job(job.id!)}>
            <div className="flex flex-col gap-0">
              {job.jobId}
              <HStack spacing={1}>
                <JobStatus status={job.status} />
                {[
                  "Draft",
                  "Planned",
                  "In Progress",
                  "Ready",
                  "Paused",
                ].includes(job.status ?? "") && (
                  <>
                    {job.dueDate &&
                      isSameDay(parseDate(job.dueDate), todaysDate) && (
                        <JobStatus status="Due Today" />
                      )}
                    {job.dueDate && parseDate(job.dueDate) < todaysDate && (
                      <JobStatus status="Overdue" />
                    )}
                  </>
                )}
              </HStack>
            </div>
          </Hyperlink>
          <Assignee
            id={job.id!}
            table="job"
            size="sm"
            value={job.assignee ?? ""}
            isReadOnly={!permissions.can("update", "production")}
          />
        </HStack>
        <HStack className="justify-between items-center" spacing={8}>
          <div>
            <label className="text-xs text-muted-foreground">Complete</label>
            <p className="text-sm">
              {job.quantityComplete ?? 0}/{job.productionQuantity ?? 0}
            </p>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Shipped</label>
            <p className="text-sm">
              {job.quantityShipped ?? 0}/{job.quantityComplete ?? 0}
            </p>
          </div>
        </HStack>
        <HStack>
          <Button
            onClick={releaseModal.onOpen}
            isLoading={
              statusFetcher.state !== "idle" &&
              statusFetcher.formData?.get("status") === "Ready"
            }
            isDisabled={
              job.status !== "Draft" ||
              statusFetcher.state !== "idle" ||
              !permissions.can("update", "production") ||
              (job?.quantity === 0 && job?.scrapQuantity === 0)
            }
            leftIcon={<LuCirclePlay />}
            variant="secondary"
            size="sm"
          >
            Release
          </Button>
          <IconButton
            aria-label={disclosure.isOpen ? "Collapse" : "Expand"}
            icon={disclosure.isOpen ? <LuChevronDown /> : <LuChevronRight />}
            variant="ghost"
            onClick={(e) => {
              e.stopPropagation();
              disclosure.onToggle();
            }}
          />
        </HStack>
      </HStack>

      {disclosure.isOpen && <JobDetails job={job as Job} />}
      {releaseModal.isOpen && (
        <JobStartModal
          job={job as Job}
          onClose={releaseModal.onClose}
          fetcher={statusFetcher}
        />
      )}
    </VStack>
  );
}

function JobDetails({ job }: { job: Job }) {
  const { carbon } = useCarbon();
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(true);
  const [jobOperations, setJobOperations] = useState<JobOperation[]>([]);

  const getJobOperations = async () => {
    if (!carbon) {
      toast.error("Failed to load job operations");
      return;
    }

    const [operations] = await Promise.all([
      carbon
        .from("jobOperation")
        .select(
          "*, jobMakeMethod(parentMaterialId, item(readableIdWithRevision))"
        )
        .eq("jobId", job.id!),
    ]);

    if (operations.error) {
      toast.error("Failed to load job operations");
      return;
    }

    flushSync(() => {
      setJobOperations(operations.data);
      setIsLoading(false);
    });
  };

  useMount(() => {
    getJobOperations();
  });

  if (jobOperations.length === 0 && !isLoading) {
    return <Empty>No operations found</Empty>;
  }

  return (
    <Loading isLoading={isLoading} className="min-h-[200px]">
      <VStack spacing={2} className="pt-4">
        {jobOperations
          .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
          .map((operation) => (
            <div className="flex w-full items-center" key={operation.id}>
              <div className="grow h-full bg-muted/30 border border-border rounded-lg w-full">
                <div className="grid items-center justify-between grid-cols-[1fr_auto] w-full gap-2 px-3 md:px-4 py-2 md:py-3">
                  <VStack spacing={0}>
                    <HStack className="w-full justify-between">
                      <h3 className="font-semibold truncate">
                        {operation.description}
                      </h3>
                      <HStack spacing={1}>
                        {operation.operationType === "Outside" ? (
                          <Badge>Outside</Badge>
                        ) : (
                          <>
                            {(operation?.setupTime ?? 0) > 0 && (
                              <Badge variant="secondary">
                                <TimeTypeIcon
                                  type="Setup"
                                  className="h-3 w-3 mr-1"
                                />
                                {operation.setupTime} {operation.setupUnit}
                              </Badge>
                            )}
                            {(operation?.laborTime ?? 0) > 0 && (
                              <Badge variant="secondary">
                                <TimeTypeIcon
                                  type="Labor"
                                  className="h-3 w-3 mr-1"
                                />
                                {operation.laborTime} {operation.laborUnit}
                              </Badge>
                            )}

                            {(operation?.machineTime ?? 0) > 0 && (
                              <Badge variant="secondary">
                                <TimeTypeIcon
                                  type="Machine"
                                  className="h-3 w-3 mr-1"
                                />
                                {operation.machineTime} {operation.machineUnit}
                              </Badge>
                            )}
                          </>
                        )}
                      </HStack>
                    </HStack>
                    {operation.operationType === "Outside" ? (
                      <SupplierProcessPreview
                        processId={operation.processId}
                        supplierProcessId={
                          operation.operationSupplierProcessId ?? undefined
                        }
                      />
                    ) : (
                      <div className="py-2 w-full">
                        <Progress
                          value={Math.min(
                            ((operation.quantityComplete ?? 0) /
                              (operation.operationQuantity ?? 0)) *
                              100,
                            100
                          )}
                          numerator={(
                            operation.quantityComplete ?? 0
                          ).toString()}
                          denominator={(
                            operation.operationQuantity ?? 0
                          ).toString()}
                        />
                      </div>
                    )}
                  </VStack>

                  <IconButton
                    aria-label="Edit"
                    icon={<LuSettings2 />}
                    variant="ghost"
                    onClick={() => {
                      navigate(
                        `${
                          operation.jobMakeMethod?.parentMaterialId
                            ? path.to.jobMakeMethod(
                                operation.jobId,
                                operation.jobMakeMethodId ?? ""
                              )
                            : path.to.jobMethod(
                                operation.jobId,
                                operation.jobMakeMethodId ?? ""
                              )
                        }?selectedOperation=${operation.id}`
                      );
                    }}
                  />
                </div>
                <div className="flex w-full items-center justify-between border-t border-border px-3 md:px-4 py-2 md:py-3">
                  <HStack>
                    <JobOperationStatus
                      operation={operation}
                      onChange={(status) => {
                        setJobOperations((prev) =>
                          prev.map((op) =>
                            op.id === operation.id ? { ...op, status } : op
                          )
                        );
                      }}
                    />
                    <Assignee
                      id={operation.id!}
                      table="jobOperation"
                      size="sm"
                      onChange={(selected) => {
                        setJobOperations((prev) =>
                          prev.map((op) =>
                            op.id === operation.id
                              ? { ...op, assignee: selected }
                              : op
                          )
                        );
                      }}
                      value={operation.assignee ?? undefined}
                    />
                  </HStack>
                </div>
              </div>
            </div>
          ))}
      </VStack>
    </Loading>
  );
}
