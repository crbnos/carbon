import { Hidden, Number, Submit, ValidatedForm } from "@carbon/form";
import { Badge, HStack, IconButton, VStack } from "@carbon/react";
import { useEffect, useState } from "react";
import { LuCirclePlus, LuTrash } from "react-icons/lu";
import { useFetcher } from "react-router";
import { Tool } from "~/components/Form";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import { assemblyStepToolValidator } from "../../production.models";
import type { AssemblyStepTool } from "../../types";

type AssemblyStepToolsProps = {
  stepId: string;
  instructionId: string;
  tools: AssemblyStepTool[];
  isDisabled: boolean;
};

/**
 * Tools used at this step. Stored by itemId (a tool-type item) — the same
 * target jobOperationTool.toolId references, so the BOP sync maps rows 1:1.
 */
export default function AssemblyStepTools({
  stepId,
  instructionId,
  tools,
  isDisabled
}: AssemblyStepToolsProps) {
  const permissions = usePermissions();
  const fetcher = useFetcher<{ success: boolean }>();
  // Remount the form after a successful add so the fields clear
  const [formKey, setFormKey] = useState(0);

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.success) {
      setFormKey((key) => key + 1);
    }
  }, [fetcher.state, fetcher.data]);

  return (
    <VStack spacing={2} className="w-full">
      <h4 className="text-xxs text-foreground/70 uppercase font-light tracking-wide">
        Tools
      </h4>
      {tools.length === 0 ? (
        <p className="text-xs text-muted-foreground">No tools to display</p>
      ) : (
        <ul className="w-full">
          {tools.map((tool) => (
            <ToolRow
              key={tool.id}
              tool={tool}
              instructionId={instructionId}
              isDisabled={isDisabled}
            />
          ))}
        </ul>
      )}
      {!isDisabled && permissions.can("create", "production") && (
        <ValidatedForm
          key={formKey}
          validator={assemblyStepToolValidator}
          method="post"
          action={path.to.newAssemblyStepTool(instructionId)}
          fetcher={fetcher}
          className="w-full"
        >
          <Hidden name="stepId" value={stepId} />
          <VStack spacing={2} className="w-full">
            <Tool
              name="itemId"
              placeholder="Pick a tool"
              disabledTools={tools.map((tool) => tool.itemId)}
            />
            <HStack className="w-full items-end" spacing={2}>
              <div className="flex-1 min-w-0">
                <Number
                  name="quantity"
                  label="Quantity"
                  minValue={1}
                  defaultValue={1}
                />
              </div>
              <Submit
                variant="secondary"
                leftIcon={<LuCirclePlus />}
                isDisabled={fetcher.state !== "idle"}
              >
                Add
              </Submit>
            </HStack>
          </VStack>
        </ValidatedForm>
      )}
    </VStack>
  );
}

function ToolRow({
  tool,
  instructionId,
  isDisabled
}: {
  tool: AssemblyStepTool;
  instructionId: string;
  isDisabled: boolean;
}) {
  const deleteFetcher = useFetcher<{ success: boolean }>();
  const permissions = usePermissions();

  // Optimistically remove the row while the delete is in flight
  if (deleteFetcher.state !== "idle") return null;

  return (
    <li className="flex w-full items-center gap-2 border-b border-border py-1.5 text-sm">
      <span
        className="min-w-0 flex-1 truncate"
        title={tool.item?.name ?? undefined}
      >
        {tool.item?.name}
      </span>
      {tool.item?.readableIdWithRevision && (
        <span className="text-xs text-muted-foreground">
          {tool.item.readableIdWithRevision}
        </span>
      )}
      <Badge variant="secondary" className="tabular-nums">
        ×{tool.quantity}
      </Badge>
      {!isDisabled && permissions.can("delete", "production") && (
        <IconButton
          aria-label={`Delete ${tool.item?.name ?? "tool"}`}
          icon={<LuTrash />}
          variant="ghost"
          size="sm"
          onClick={() => {
            deleteFetcher.submit(new FormData(), {
              method: "post",
              action: path.to.deleteAssemblyStepTool(instructionId, tool.id)
            });
          }}
        />
      )}
    </li>
  );
}
