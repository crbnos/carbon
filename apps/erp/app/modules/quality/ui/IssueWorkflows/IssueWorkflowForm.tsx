import { useCarbon } from "@carbon/auth";
import { MultiSelect, Select, ValidatedForm } from "@carbon/form";
import type { JSONContent } from "@carbon/react";
import {
  Button,
  Card,
  CardContent,
  Checkbox,
  generateHTML,
  Heading,
  HStack,
  toast,
  VStack
} from "@carbon/react";
import { Editor } from "@carbon/react/Editor";
import { Reorder, useDragControls } from "framer-motion";
import { nanoid } from "nanoid";
import { useEffect, useState } from "react";
import { LuGripVertical, LuX } from "react-icons/lu";
import type { z } from "zod";
import { Hidden, Input, Submit } from "~/components/Form";
import { usePermissions, useUser } from "~/hooks";
import type { ListItem } from "~/types";
import { getPrivateUrl, path } from "~/utils/path";
import {
  issueWorkflowValidator,
  nonConformanceApprovalRequirement,
  nonConformancePriority,
  nonConformanceSource
} from "../../quality.models";
import { getPriorityIcon } from "../Issue/IssueIcons";

type IssueWorkflowFormProps = {
  initialValues: z.infer<typeof issueWorkflowValidator>;
  requiredActions: ListItem[];
  onClose: () => void;
};

function ReorderableActionItem({
  action,
  onRemove
}: {
  action: ListItem;
  onRemove: () => void;
}) {
  const dragControls = useDragControls();

  return (
    <Reorder.Item
      value={action.id}
      dragListener={false}
      dragControls={dragControls}
      className="w-full"
    >
      <div className="flex items-center gap-2 bg-card border rounded-lg px-3 py-2 w-full">
        <button
          className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground transition-colors p-1"
          onPointerDown={(e) => dragControls.start(e)}
        >
          <LuGripVertical size={16} />
        </button>
        <span className="flex-1 text-sm">{action.name}</span>
        <button
          type="button"
          onClick={onRemove}
          className="text-muted-foreground hover:text-destructive transition-colors p-1"
        >
          <LuX size={16} />
        </button>
      </div>
    </Reorder.Item>
  );
}

const IssueWorkflowForm = ({
  initialValues,
  requiredActions,
  onClose
}: IssueWorkflowFormProps) => {
  const permissions = usePermissions();

  const [content, setContent] = useState<JSONContent>(
    (JSON.parse(initialValues?.content ?? {}) as JSONContent) ?? {}
  );

  // State for managing selected required actions in order
  const [selectedActionIds, setSelectedActionIds] = useState<string[]>(
    initialValues.requiredActionIds ?? []
  );

  // Update selectedActionIds when initialValues changes
  useEffect(() => {
    setSelectedActionIds(initialValues.requiredActionIds ?? []);
  }, [initialValues.requiredActionIds]);

  const isEditing = initialValues.id !== undefined;
  const isDisabled = isEditing
    ? !permissions.can("update", "quality")
    : !permissions.can("create", "quality");

  // Get the ordered list of selected actions
  const orderedActions = selectedActionIds
    .map((id) => requiredActions.find((action) => action.id === id))
    .filter((action): action is ListItem => action !== undefined);

  // Get available actions that haven't been selected yet
  const availableActions = requiredActions.filter(
    (action) => !selectedActionIds.includes(action.id)
  );

  const handleReorder = (newOrder: string[]) => {
    setSelectedActionIds(newOrder);
  };

  const handleAddAction = (actionId: string) => {
    if (!selectedActionIds.includes(actionId)) {
      setSelectedActionIds([...selectedActionIds, actionId]);
    }
  };

  const handleRemoveAction = (actionId: string) => {
    setSelectedActionIds(selectedActionIds.filter((id) => id !== actionId));
  };

  const { carbon } = useCarbon();
  const {
    company: { id: companyId }
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
      <Hidden
        name="requiredActionIds"
        value={JSON.stringify(selectedActionIds)}
      />
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
              Issue workflows defined the preset values for an issue. For
              example, you can have an 8D workflow or a containment workflow.
            </p>
          </VStack>
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
                    __html: generateHTML(content)
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
              value: priority
            }))}
          />
          <Select
            name="source"
            label="Source"
            options={nonConformanceSource.map((source) => ({
              label: source,
              value: source
            }))}
          />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full">
          <VStack spacing={2}>
            <label
              htmlFor="requiredActions"
              className="text-xs text-muted-foreground font-medium"
            >
              Required Actions (in order)
            </label>

            {orderedActions.length > 0 && (
              <Reorder.Group
                axis="y"
                values={selectedActionIds}
                onReorder={handleReorder}
                className="w-full space-y-2"
              >
                {orderedActions.map((action) => (
                  <ReorderableActionItem
                    key={action.id}
                    action={action}
                    onRemove={() => handleRemoveAction(action.id)}
                  />
                ))}
              </Reorder.Group>
            )}

            {orderedActions.length === 0 && (
              <p className="text-sm text-muted-foreground italic">
                No actions selected
              </p>
            )}
          </VStack>

          <VStack spacing={2}>
            <p className="text-xs text-muted-foreground font-medium">
              Available Actions (click to add)
            </p>
            {availableActions.length > 0 ? (
              <div className="flex flex-col gap-2">
                {availableActions.map((action) => (
                  <button
                    key={action.id}
                    type="button"
                    onClick={() => handleAddAction(action.id)}
                    className="flex items-center gap-2 px-3 py-2 border border-dashed rounded-lg hover:bg-accent hover:text-accent-foreground transition-colors text-left text-sm"
                  >
                    <Checkbox
                      onClick={(e) => e.preventDefault()}
                      isChecked={false}
                      disabled
                    />
                    <span>{action.name}</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground italic">
                All actions selected
              </p>
            )}
          </VStack>
        </div>

        <MultiSelect
          name="approvalRequirements"
          label="Approval Requirements"
          options={nonConformanceApprovalRequirement.map((requirement) => ({
            label: requirement,
            value: requirement
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
