import {
  DatePicker,
  MultiSelect,
  Select,
  SelectControlled,
  TextArea,
  ValidatedForm,
} from "@carbon/form";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  VStack,
} from "@carbon/react";
import { useState } from "react";
import type { z } from "zod";
import {
  CustomFormFields,
  Hidden,
  Input,
  Item,
  Location,
  Submit,
} from "~/components/Form";
import { usePermissions } from "~/hooks";
import type { MethodItemType } from "~/modules/shared";
import type { ListItem } from "~/types";
import {
  issueValidator,
  nonConformanceApprovalRequirement,
  nonConformanceInvestigationType,
  nonConformancePriority,
  nonConformanceRequiredAction,
  nonConformanceSource,
} from "../../quality.models";
import type { IssueWorkflow } from "../../types";
import { getPriorityIcon, getSourceIcon } from "./IssueIcons";

type IssueFormValues = z.infer<typeof issueValidator>;

type IssueFormProps = {
  initialValues: IssueFormValues;
  nonConformanceWorkflows: IssueWorkflow[];
  nonConformanceTypes: ListItem[];
};

const IssueForm = ({
  initialValues,
  nonConformanceWorkflows,
  nonConformanceTypes,
}: IssueFormProps) => {
  const permissions = usePermissions();
  const isEditing = initialValues.id !== undefined;

  const [workflow, setWorkflow] = useState<{
    priority: string;
    source: string;
    investigationTypes: string[];
    requiredActions: string[];
    approvalRequirements: string[];
  }>({
    priority: initialValues.priority,
    source: initialValues.source,
    investigationTypes: initialValues.investigationTypes ?? [],
    requiredActions: initialValues.requiredActions ?? [],
    approvalRequirements: initialValues.approvalRequirements ?? [],
  });

  const [itemType, setItemType] = useState<string>("Item");

  const onWorkflowChange = (value: { value: string } | null) => {
    if (value) {
      const selectedWorkflow = nonConformanceWorkflows.find(
        (w) => w.id === value.value
      );
      if (selectedWorkflow) {
        setWorkflow({
          priority: selectedWorkflow.priority,
          source: selectedWorkflow.source,
          investigationTypes: selectedWorkflow.investigationTypes ?? [],
          requiredActions: selectedWorkflow.requiredActions ?? [],
          approvalRequirements: selectedWorkflow.approvalRequirements ?? [],
        });
      }
    }
  };

  return (
    <Card>
      <ValidatedForm
        method="post"
        validator={issueValidator}
        defaultValues={initialValues}
        className="w-full"
      >
        <CardHeader>
          <CardTitle>{isEditing ? "Issue" : "New Issue"}</CardTitle>
          {!isEditing && (
            <CardDescription>
              A issue record tracks quality issues and their resolution process.
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

          <VStack spacing={4}>
            <div className="grid w-full gap-4 grid-cols-1 md:grid-cols-2">
              <Input name="name" label="Name" />
              <Item
                name="itemId"
                label="Item"
                type={itemType as MethodItemType}
                onTypeChange={(value) => {
                  setItemType(value as string);
                }}
              />
            </div>
            <TextArea name="description" label="Description" />
            <div className="grid w-full gap-4 grid-cols-1 md:grid-cols-2">
              <Select
                name="nonConformanceWorkflowId"
                label="Workflow"
                options={nonConformanceWorkflows.map((workflow) => ({
                  label: workflow.name,
                  value: workflow.id,
                }))}
                onChange={onWorkflowChange}
              />

              <Select
                name="nonConformanceTypeId"
                label="Issue Type"
                options={nonConformanceTypes.map((type) => ({
                  label: type.name,
                  value: type.id,
                }))}
              />
            </div>

            <VStack spacing={4}>
              <MultiSelect
                name="investigationTypes"
                label="Investigation Types"
                options={nonConformanceInvestigationType.map((type) => ({
                  label: type,
                  value: type,
                }))}
                value={workflow.investigationTypes}
                onChange={(value) => {
                  setWorkflow({
                    ...workflow,
                    investigationTypes: value.map((v) => v.value),
                  });
                }}
              />
              <MultiSelect
                name="requiredActions"
                label="Required Actions"
                options={nonConformanceRequiredAction.map((action) => ({
                  label: action,
                  value: action,
                }))}
                value={workflow.requiredActions}
                onChange={(value) => {
                  setWorkflow({
                    ...workflow,
                    requiredActions: value.map((v) => v.value),
                  });
                }}
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
                value={workflow.approvalRequirements}
                onChange={(value) => {
                  setWorkflow({
                    ...workflow,
                    approvalRequirements: value.map((v) => v.value),
                  });
                }}
              />
            </VStack>
            <div className="grid w-full gap-4 grid-cols-1 md:grid-cols-2">
              <SelectControlled
                name="priority"
                label="Priority"
                options={nonConformancePriority.map((priority) => ({
                  label: (
                    <div className="flex gap-2 items-center">
                      {getPriorityIcon(priority, false)}
                      <span>{priority}</span>
                    </div>
                  ),
                  value: priority,
                }))}
                value={workflow.priority}
                onChange={(value) => {
                  setWorkflow({
                    ...workflow,
                    priority: value?.value ?? "",
                  });
                }}
              />
              <SelectControlled
                name="source"
                label="Source"
                options={nonConformanceSource.map((source) => ({
                  label: (
                    <div className="flex gap-2 items-center">
                      {getSourceIcon(source, false)}
                      <span>{source}</span>
                    </div>
                  ),
                  value: source,
                }))}
                value={workflow.source}
                onChange={(value) => {
                  setWorkflow({
                    ...workflow,
                    source: value?.value ?? "",
                  });
                }}
              />

              <DatePicker name="openDate" label="Open Date" />
              <Location name="locationId" label="Location" />
              <CustomFormFields table="nonConformance" />
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

export default IssueForm;
