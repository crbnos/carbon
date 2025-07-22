import { useCarbon } from "@carbon/auth";
import { MultiSelect, Select, ValidatedForm } from "@carbon/form";
import type { JSONContent } from "@carbon/react";
import {
  Button,
  Card,
  CardContent,
  Heading,
  HStack,
  toast,
  VStack,
} from "@carbon/react";
import { Editor, generateHTML } from "@carbon/react/Editor";
import { nanoid } from "nanoid";
import { useState } from "react";
import type { z } from "zod";
import { Hidden, Input, Submit } from "~/components/Form";
import { usePermissions, useUser } from "~/hooks";
import { getPrivateUrl, path } from "~/utils/path";
import {
  issueWorkflowValidator,
  nonConformanceApprovalRequirement,
  nonConformanceInvestigationType,
  nonConformancePriority,
  nonConformanceRequiredAction,
  nonConformanceSource,
} from "../../quality.models";
import { getPriorityIcon } from "../Issue/IssueIcons";

type IssueWorkflowFormProps = {
  initialValues: z.infer<typeof issueWorkflowValidator>;
  onClose: () => void;
};

const IssueWorkflowForm = ({
  initialValues,
  onClose,
}: IssueWorkflowFormProps) => {
  const permissions = usePermissions();

  const [content, setContent] = useState<JSONContent>(
    (JSON.parse(initialValues?.content ?? {}) as JSONContent) ?? {}
  );

  const isEditing = initialValues.id !== undefined;
  const isDisabled = isEditing
    ? !permissions.can("update", "quality")
    : !permissions.can("create", "quality");

  const { carbon } = useCarbon();
  const {
    company: { id: companyId },
  } = useUser();

  const onUploadImage = async (file: File) => {
    const fileType = file.name.split(".").pop();
    const fileName = `${companyId}/parts/${nanoid()}.${fileType}`;

    const result = await carbon?.storage.from("private").upload(fileName, file);

    if (result?.error) {
      toast.error("Failed to upload image");
      throw new Error(result.error.message);
    }

    if (!result?.data) {
      throw new Error("Failed to upload image");
    }

    return getPrivateUrl(result.data.path);
  };

  return (
    <ValidatedForm
      key={initialValues.id}
      validator={issueWorkflowValidator}
      defaultValues={initialValues}
      method="post"
      action={
        isEditing
          ? path.to.issueWorkflow(initialValues.id!)
          : path.to.newIssueWorkflow
      }
    >
      <Hidden name="id" value={initialValues.id} />
      <Hidden name="content" value={JSON.stringify(content)} />
      <VStack
        spacing={4}
        className="py-12 px-4 max-w-[50rem] h-full mx-auto gap-2"
      >
        <HStack className="w-full justify-between">
          <VStack spacing={0}>
            <Heading size="h3">
              {isEditing ? "Edit" : "New"}{" "}
              <span className="hidden md:inline">Issue</span> Workflow
            </Heading>
            <p className="text-sm text-muted-foreground">
              Non-conformance workflows are used as a starting point for issues.
              Each issue workflow uses a workflow to create the issue. A single
              workflow can be used in multiple workflows.
            </p>
          </VStack>
          {/* <div className="ml-auto">
            <DropdownMenu>
            <DropdownMenuTrigger asChild>
            <IconButton aria-labell="More options" icon={<LuEllipsisVertical />} variant="secondary" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
            <DropdownMenuItem>
            <span>Duplicate</span>
            </DropdownMenuItem>
            
            <DropdownMenuSeparator />
            <DropdownMenuItem destructive>
            <span>Delete</span>
            </DropdownMenuItem>
            </DropdownMenuContent>
            </DropdownMenu>
            </div> */}
        </HStack>
        <Input name="name" label="Name" />
        <VStack spacing={2}>
          <label
            htmlFor="content"
            className="text-xs text-muted-foreground font-medium"
          >
            Issue Template
          </label>
          <Card className="p-0 bg-transparent dark:from-transparent  dark:via-transparent dark:to-transparent">
            <CardContent className="flex flex-col gap-0 p-6">
              {permissions.can("update", "quality") ? (
                <Editor
                  initialValue={content}
                  onUpload={onUploadImage}
                  onChange={(value) => {
                    setContent(value);
                  }}
                  className="[&_.is-empty]:text-muted-foreground min-h-[120px]"
                />
              ) : (
                <div
                  className="prose dark:prose-invert"
                  dangerouslySetInnerHTML={{
                    __html: generateHTML(content),
                  }}
                />
              )}
            </CardContent>
          </Card>
        </VStack>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full">
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
        </div>
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
          options={nonConformanceApprovalRequirement.map((requirement) => ({
            label: requirement,
            value: requirement,
          }))}
        />

        <HStack className="w-full justify-end">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Submit isDisabled={isDisabled}>Save</Submit>
        </HStack>
      </VStack>
    </ValidatedForm>
  );
};

export default IssueWorkflowForm;
