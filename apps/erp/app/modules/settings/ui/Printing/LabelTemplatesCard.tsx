// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Input, Select, Submit, ValidatedForm } from "@carbon/form";
import {
  type LabelTemplateType,
  labelTemplateTypes,
  labelTemplateValidator
} from "@carbon/printing";
import { useAction } from "@carbon/query";
import {
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuTrigger,
  HStack,
  IconButton,
  MENU_ITEM_SHORTCUTS,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  toast,
  useDisclosure
} from "@carbon/react";
import { getLabelSizeLabel, labelSizes } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { LuEllipsisVertical, LuPencil, LuPlus, LuTrash } from "react-icons/lu";
import { Empty } from "~/components";
import ConfirmDelete from "~/components/Modals/ConfirmDelete";
import { path } from "~/utils/path";
import { getMediaSizeLabel } from "./PrintersCard";

type LabelTemplate = {
  id: string;
  labelType: LabelTemplateType;
  mediaSizeId: string;
  templateId: string;
};

const mediaSizeOptions = labelSizes.map((size) => ({
  value: size.id,
  label: getLabelSizeLabel(size)
}));

export function LabelTemplatesCard({
  labelTemplates
}: {
  labelTemplates: LabelTemplate[];
}) {
  const { t } = useLingui();
  // The dialogs stay mounted so they animate out; the row they show is kept
  // apart from whether they are open. `row` is null while adding.
  const editor = useDisclosure();
  const [row, setRow] = useState<LabelTemplate | null>(null);
  const deleteConfirm = useDisclosure();
  const [deleting, setDeleting] = useState<LabelTemplate | null>(null);
  const fetcher = useAction({
    onSuccess: ({ data }) => {
      if (!data) return;
      toast.success(
        data.created ? t`Label template created` : t`Label template updated`
      );
      editor.onClose();
    }
  });

  const labelTypeNames: Record<LabelTemplateType, string> = {
    serialLabel: t`Serial Number Label`,
    batchLabel: t`Batch Label`,
    kanbanCard: t`Kanban Card`,
    storageUnitLabel: t`Storage Unit Label`
  };
  const labelTypeOptions = labelTemplateTypes.map((id) => ({
    value: id,
    label: labelTypeNames[id]
  }));

  return (
    <>
      <Card>
        <HStack className="w-full justify-between items-start max-md:flex-col max-md:items-stretch max-md:gap-0">
          <CardHeader>
            <CardTitle>
              <Trans>Label Templates</Trans>
            </CardTitle>
            <CardDescription>
              <Trans>
                BinderyPress templates by label type and media size. A printer
                uses the template for its media size; labels without one print
                with the built-in layout.
              </Trans>
            </CardDescription>
          </CardHeader>
          <CardAction className="py-6 max-md:pt-0 max-md:pb-4 max-md:px-4">
            <Button
              leftIcon={<LuPlus />}
              onClick={() => {
                setRow(null);
                editor.onOpen();
              }}
            >
              <Trans>Add Template</Trans>
            </Button>
          </CardAction>
        </HStack>
        <CardContent>
          {labelTemplates.length > 0 ? (
            <div className="flex flex-col gap-2">
              {labelTemplates.map((template) => (
                <div
                  key={template.id}
                  className="flex items-center justify-between rounded-lg border border-border p-3"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-sm font-medium">
                      {labelTypeNames[template.labelType]}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {getMediaSizeLabel(template.mediaSizeId)}
                    </span>
                    <span className="text-xs text-muted-foreground font-mono truncate max-w-[300px]">
                      {template.templateId}
                    </span>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <IconButton
                        aria-label={t`More`}
                        icon={<LuEllipsisVertical />}
                        variant="ghost"
                        size="sm"
                      />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        shortcut={MENU_ITEM_SHORTCUTS.edit}
                        onSelect={() => {
                          setRow(template);
                          editor.onOpen();
                        }}
                      >
                        <DropdownMenuIcon icon={<LuPencil />} />
                        <Trans>Edit</Trans>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        shortcut={MENU_ITEM_SHORTCUTS.delete}
                        destructive
                        onSelect={() => {
                          setDeleting(template);
                          deleteConfirm.onOpen();
                        }}
                      >
                        <DropdownMenuIcon icon={<LuTrash />} />
                        <Trans>Delete</Trans>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              ))}
            </div>
          ) : (
            <Empty>
              <p className="text-sm text-muted-foreground mt-10">
                <Trans>
                  No label templates. Every label prints with the built-in
                  layout.
                </Trans>
              </p>
            </Empty>
          )}
        </CardContent>
      </Card>

      <Modal
        open={editor.isOpen}
        onOpenChange={(open) => {
          if (!open) editor.onClose();
        }}
      >
        <ModalContent>
          <ValidatedForm
            key={row?.id ?? "new"}
            method="post"
            validator={labelTemplateValidator}
            fetcher={fetcher}
            defaultValues={row ?? {}}
            className="flex flex-col h-full"
          >
            <input type="hidden" name="intent" value="upsertLabelTemplate" />
            {row && <input type="hidden" name="id" value={row.id} />}
            <ModalHeader>
              <ModalTitle>
                {row ? (
                  <Trans>Edit Label Template</Trans>
                ) : (
                  <Trans>Add Label Template</Trans>
                )}
              </ModalTitle>
            </ModalHeader>
            <ModalBody>
              <div className="grid grid-cols-1 gap-4">
                <Select
                  name="labelType"
                  label={t`Label Type`}
                  options={labelTypeOptions}
                />
                <Select
                  name="mediaSizeId"
                  label={t`Media Size`}
                  options={mediaSizeOptions}
                />
                <Input
                  name="templateId"
                  label={t`Template ID`}
                  placeholder={t`BinderyPress template ID`}
                />
              </div>
            </ModalBody>
            <ModalFooter>
              <HStack>
                <Button size="md" variant="solid" onClick={editor.onClose}>
                  <Trans>Cancel</Trans>
                </Button>
                <Submit>
                  {row ? <Trans>Save</Trans> : <Trans>Add Template</Trans>}
                </Submit>
              </HStack>
            </ModalFooter>
          </ValidatedForm>
        </ModalContent>
      </Modal>

      <ConfirmDelete
        action={deleting ? path.to.deleteLabelTemplate(deleting.id) : ""}
        isOpen={deleteConfirm.isOpen}
        name={deleting ? labelTypeNames[deleting.labelType] : ""}
        text={
          deleting
            ? t`Delete the ${labelTypeNames[deleting.labelType]} template for ${getMediaSizeLabel(deleting.mediaSizeId)}? These labels will print with the built-in layout.`
            : ""
        }
        onCancel={deleteConfirm.onClose}
        onSubmit={deleteConfirm.onClose}
      />
    </>
  );
}
