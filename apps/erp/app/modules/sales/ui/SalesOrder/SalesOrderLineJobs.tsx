import { ValidatedForm } from "@carbon/form";
import {
  Button,
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
  HStack,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  useDisclosure,
} from "@carbon/react";
import { useParams } from "@remix-run/react";
import { useState } from "react";
import { LuCirclePlus, LuHardHat } from "react-icons/lu";
import { Assignee, Empty, Hyperlink } from "~/components";
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

import {
  deadlineTypes,
  salesOrderToJobValidator,
} from "~/modules/production/production.models";
import type { Job } from "~/modules/production/types";
import JobStatus from "~/modules/production/ui/Jobs/JobStatus";
import { path } from "~/utils/path";
import type { Opportunity, SalesOrder, SalesOrderLine } from "../../types";

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
  const permissions = usePermissions();
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
            <Table>
              <Thead>
                <Tr>
                  <Th>Job ID</Th>
                  <Th>Status</Th>
                  <Th>Quantity</Th>
                  <Th>Complete</Th>
                  <Th>Assignee</Th>
                </Tr>
              </Thead>
              <Tbody>
                {jobs.map((job) => (
                  <Tr key={job.id}>
                    <Td>
                      <Hyperlink to={path.to.job(job.id!)}>
                        {job.jobId}
                      </Hyperlink>
                    </Td>
                    <Td>
                      <JobStatus status={job.status} />
                    </Td>
                    <Td>{job.quantity}</Td>
                    <Td>{job.quantityComplete}</Td>
                    <Td>
                      <Assignee
                        id={job.id!}
                        table="job"
                        value={job.assignee ?? ""}
                        isReadOnly={!permissions.can("update", "production")}
                      />
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
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
                quoteId: opportunity.quoteId ?? undefined,
                quoteLineId: opportunity.quoteId ? lineId : undefined,
                salesOrderId: opportunity.salesOrderId ?? undefined,
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
                      label: d,
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
