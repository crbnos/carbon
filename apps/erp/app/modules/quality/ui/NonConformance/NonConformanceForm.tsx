import { DatePicker, MultiSelect, Select, ValidatedForm } from "@carbon/form";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  VStack,
} from "@carbon/react";
import type { z } from "zod";
import { Hidden, Input, Location, Submit } from "~/components/Form";
import { usePermissions } from "~/hooks";
import {
  nonConformanceApprovalRequirement,
  nonConformanceInvestigationType,
  nonConformancePriority,
  nonConformanceRequiredAction,
  nonConformanceSource,
  nonConformanceValidator,
} from "../../quality.models";
import { getPriorityIcon } from "./NonConformancePriority";
import type { ListItem } from "~/types";

type NonConformanceFormValues = z.infer<typeof nonConformanceValidator>;

type NonConformanceFormProps = {
  initialValues: NonConformanceFormValues;
  nonConformanceWorkflows: ListItem[];
  nonConformanceTypes: ListItem[];
};

const NonConformanceForm = ({
  initialValues,
  nonConformanceWorkflows,
  nonConformanceTypes,
}: NonConformanceFormProps) => {
  const permissions = usePermissions();
  const isEditing = initialValues.id !== undefined;

  return (
    <Card>
      <ValidatedForm
        method="post"
        validator={nonConformanceValidator}
        defaultValues={initialValues}
        className="w-full"
      >
        <CardHeader>
          <CardTitle>
            {isEditing ? "Non-Conformance" : "New Non-Conformance"}
          </CardTitle>
          {!isEditing && (
            <CardDescription>
              A non-conformance record tracks quality issues and their
              resolution process.
            </CardDescription>
          )}
        </CardHeader>
        <CardContent>
          <Hidden name="id" />
          <Hidden name="nonConformanceId" />
          <Hidden name="supplierId" />
          <Hidden name="customerId" />
          <Hidden name="jobId" />
          <Hidden name="jobOperationId" />
          <Hidden name="purchaseOrderId" />
          <Hidden name="purchaseOrderLineId" />
          <Hidden name="salesOrderId" />
          <Hidden name="salesOrderLineId" />
          <Hidden name="shipmentId" />
          <Hidden name="shipmentLineId" />
          <Hidden name="trackedEntityId" />
          <Hidden name="itemId" />

          <VStack>
            <div className="grid w-full gap-x-8 gap-y-4 grid-cols-1 md:grid-cols-2">
              <Input name="name" label="Name" />
              <Select
                name="priority"
                label="Priority"
                options={nonConformancePriority.map((priority) => ({
                  label: (
                    <div className="flex gap-1 items-center">
                      {getPriorityIcon(priority, false)}
                      <span>{priority}</span>
                    </div>
                  ),
                  value: priority,
                }))}
              />
              <Select
                name="source"
                label="Source"
                options={nonConformanceSource.map((source) => ({
                  label: source,
                  value: source,
                }))}
              />
              <Location name="locationId" label="Location" />
              <Select
                name="nonConformanceWorkflowId"
                label="Workflow"
                options={nonConformanceWorkflows.map((workflow) => ({
                  label: workflow.name,
                  value: workflow.id,
                }))}
              />
              <Select
                name="nonConformanceTypeId"
                label="Type"
                options={nonConformanceTypes.map((type) => ({
                  label: type.name,
                  value: type.id,
                }))}
              />
              <DatePicker name="openDate" label="Open Date" />
            </div>

            <div className="w-full mt-4">
              <Input
                name="description"
                label="Description"
                className="w-full"
              />
            </div>

            <div className="grid w-full gap-x-8 gap-y-4 grid-cols-1 md:grid-cols-2 mt-4">
              <MultiSelect
                name="investigationTypes"
                label="Investigation Types"
                options={nonConformanceInvestigationType.map((type) => ({
                  label: type,
                  value: type,
                }))}
              />
              <MultiSelect
                name="requiredActions"
                label="Required Actions"
                options={nonConformanceRequiredAction.map((action) => ({
                  label: action,
                  value: action,
                }))}
              />
              <MultiSelect
                name="approvalRequirements"
                label="Approval Requirements"
                options={nonConformanceApprovalRequirement.map(
                  (requirement) => ({
                    label: requirement,
                    value: requirement,
                  })
                )}
              />
            </div>
          </VStack>
        </CardContent>
        <CardFooter>
          <Submit
            isDisabled={
              isEditing
                ? !permissions.can("update", "quality")
                : !permissions.can("create", "quality")
            }
          >
            Save
          </Submit>
        </CardFooter>
      </ValidatedForm>
    </Card>
  );
};

export default NonConformanceForm;
