// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useCarbon } from "@carbon/auth";
import {
  convertKbToString,
  downloadUrl,
  getDocumentType,
  storage
} from "@carbon/files";
import { getLogger } from "@carbon/logger";
import { useRevalidator } from "@carbon/query";
import {
  Badge,
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  File,
  HStack,
  IconButton,
  MENU_ITEM_SHORTCUTS,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  toast,
  toastError
} from "@carbon/react";
import { useDraggable } from "@dnd-kit/core";
import { Trans, useLingui } from "@lingui/react/macro";
import type { FileObject } from "@supabase/storage-js";
import type {
  ChangeEvent,
  KeyboardEventHandler,
  PointerEventHandler
} from "react";
import { createContext, useCallback, useContext } from "react";
import {
  LuEllipsisVertical,
  LuGripVertical,
  LuRadioTower,
  LuShoppingCart,
  LuUpload
} from "react-icons/lu";
import { Outlet, useFetchers, useSubmit } from "react-router";
import { DateTime, DocumentPreview, FileDropzone } from "~/components";
import DocumentIcon from "~/components/DocumentIcon";
import { useFileUpload, usePermissions, useUser } from "~/hooks";
import { path } from "~/utils/path";
import { stripSpecialCharacters } from "~/utils/string";
import type { Opportunity } from "../../types";
import { useOptimisticDocumentDrag } from "../SalesRFQ/useOptimiticDocumentDrag";

const logger = getLogger("erp", "opportunitydocuments");

/**
 * Where a page's line list takes an opportunity file (the quote and sales
 * RFQ explorers). Dragging a file there is the pointer path; the file's ⋯
 * menu offers the same drops, so attaching a file never needs a drag.
 */
type DocumentDropTargets = {
  /** The list itself: dropping here makes a new line from the file. */
  listTargetId: string;
  lines: { targetId: string; label: string }[];
  onDrop: (document: FileObject & { path: string }, targetId: string) => void;
};

const DocumentDropTargetsContext = createContext<DocumentDropTargets | null>(
  null
);
export const DocumentDropTargetsProvider = DocumentDropTargetsContext.Provider;

type OpportunityDocumentsProps = {
  attachments: FileObject[];
  opportunity: Opportunity;
  id: string;
  type: "Sales Order" | "Request for Quote" | "Quote" | "Sales Invoice";
  isReadOnly?: boolean;
};

const OpportunityDocuments = ({
  attachments,
  opportunity,
  id,
  type,
  isReadOnly: isReadOnlyProp
}: OpportunityDocumentsProps) => {
  const { t } = useLingui();
  const { canDelete, download, deleteAttachment, getPath, upload } =
    useOpportunityDocuments({
      opportunityId: opportunity.id,
      id,
      type
    });
  const effectiveCanDelete = isReadOnlyProp ? false : canDelete;
  const dropTargets = useContext(DocumentDropTargetsContext);

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      upload(acceptedFiles);
    },
    [upload]
  );

  const optimisticDrags = useOptimisticDocumentDrag();

  const attachmentsByName = new Map<string, FileObject | OptimisticFileObject>(
    attachments.map((file) => [file.name, file])
  );
  const pendingItems = usePendingItems();
  for (let pendingItem of pendingItems) {
    let item = attachmentsByName.get(pendingItem.name);
    let merged = item ? { ...item, ...pendingItem } : pendingItem;
    attachmentsByName.set(pendingItem.name, merged);
  }

  const attachmentsToRender = Array.from(attachmentsByName.values())
    .filter((d) => !optimisticDrags?.find((o) => o.id === d.id))
    .sort((a, b) => a.name.localeCompare(b.name)) as FileObject[];

  return (
    <>
      <Card>
        <HStack className="justify-between items-start">
          <CardHeader>
            <CardTitle>
              <Trans>Files</Trans>
            </CardTitle>
          </CardHeader>
          <CardAction className="max-md:hidden">
            {!isReadOnlyProp && (
              <OpportunityDocumentForm
                opportunityId={opportunity.id}
                id={id}
                type={type}
              />
            )}
          </CardAction>
        </HStack>
        <CardContent>
          <Table>
            <Thead
              className={cn(
                attachmentsToRender.length === 0 && "max-md:hidden"
              )}
            >
              <Tr>
                <Th>
                  <Trans>Name</Trans>
                </Th>
                <Th>
                  <Trans>Size</Trans>
                </Th>
                <Th>
                  <Trans>Created</Trans>
                </Th>
                <Th></Th>
              </Tr>
            </Thead>
            <Tbody>
              {attachmentsToRender.length ? (
                attachmentsToRender.map((attachment) => (
                  <Tr key={attachment.id}>
                    <DraggableCell
                      attachment={attachment}
                      canDrag={!!dropTargets}
                      opportunity={opportunity}
                      download={download}
                      getPath={getPath}
                    />
                    <Td className="text-xs font-mono">
                      {convertKbToString(
                        Math.floor((attachment.metadata?.size ?? 0) / 1024)
                      )}
                    </Td>
                    <Td className="text-xs font-mono">
                      {attachment.created_at ? (
                        <DateTime
                          value={attachment.created_at}
                          variant="date"
                        />
                      ) : (
                        "--"
                      )}
                    </Td>
                    <Td>
                      <div className="flex justify-end gap-2">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <IconButton
                              aria-label={t`More`}
                              icon={<LuEllipsisVertical />}
                              variant="secondary"
                            />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent>
                            <DropdownMenuItem
                              shortcut={MENU_ITEM_SHORTCUTS.download}
                              onClick={() => download(attachment)}
                            >
                              <Trans>Download</Trans>
                            </DropdownMenuItem>
                            {dropTargets && !isReadOnlyProp && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  onClick={() =>
                                    dropTargets.onDrop(
                                      {
                                        ...attachment,
                                        path: getPath(attachment)
                                      },
                                      dropTargets.listTargetId
                                    )
                                  }
                                >
                                  <Trans>Create line from file</Trans>
                                </DropdownMenuItem>
                                {dropTargets.lines.length > 0 && (
                                  <DropdownMenuSub>
                                    <DropdownMenuSubTrigger>
                                      <Trans>Attach to line</Trans>
                                    </DropdownMenuSubTrigger>
                                    <DropdownMenuSubContent>
                                      {dropTargets.lines.map((line) => (
                                        <DropdownMenuItem
                                          key={line.targetId}
                                          onClick={() =>
                                            dropTargets.onDrop(
                                              {
                                                ...attachment,
                                                path: getPath(attachment)
                                              },
                                              line.targetId
                                            )
                                          }
                                        >
                                          {line.label}
                                        </DropdownMenuItem>
                                      ))}
                                    </DropdownMenuSubContent>
                                  </DropdownMenuSub>
                                )}
                                <DropdownMenuSeparator />
                              </>
                            )}
                            <DropdownMenuItem
                              destructive
                              disabled={!effectiveCanDelete}
                              onClick={() => deleteAttachment(attachment)}
                            >
                              <Trans>Delete</Trans>
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </Td>
                  </Tr>
                ))
              ) : (
                <Tr>
                  <Td
                    colSpan={24}
                    className="py-8 text-muted-foreground text-center"
                  >
                    <Trans>No files uploaded</Trans>
                  </Td>
                </Tr>
              )}
            </Tbody>
          </Table>
          {!isReadOnlyProp && <FileDropzone onDrop={onDrop} />}
        </CardContent>
      </Card>

      <Outlet />
    </>
  );
};

const DraggableCell = ({
  attachment,
  canDrag,
  opportunity,
  download,
  getPath
}: {
  attachment: FileObject;
  /** The page offers drop targets the user may drop on. */
  canDrag: boolean;
  opportunity: Opportunity;
  download: (attachment: FileObject) => void;
  getPath: (attachment: FileObject) => string;
}) => {
  const { t } = useLingui();
  const fileName = attachment.name;
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: attachment.id ?? attachment.name,
    disabled: !canDrag,
    data: {
      id: attachment.id,
      name: attachment.name,
      size: attachment.metadata?.size || 0,
      path: getPath(attachment),
      type: "opportunityDocument"
    }
  });

  const style = transform
    ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
        zIndex: 1000
      }
    : undefined;

  const isPreviewable = ["PDF", "Image"].includes(
    getDocumentType(attachment.name)
  );

  const openFile = () => {
    if (isPreviewable) {
      window.open(
        path.to.file.previewFile(`private/${getPath(attachment)}`),
        "_blank"
      );
    } else {
      download(attachment);
    }
  };
  return (
    // The pointer drags from anywhere in the cell; the keyboard drags from
    // the grip, which is the one control that carries the drag role, so the
    // file name stays a button of its own.
    <Td
      ref={setNodeRef}
      style={style}
      onPointerDown={
        listeners?.onPointerDown as
          | PointerEventHandler<HTMLTableCellElement>
          | undefined
      }
    >
      <HStack>
        {canDrag && (
          <button
            type="button"
            {...attributes}
            onKeyDown={
              listeners?.onKeyDown as
                | KeyboardEventHandler<HTMLButtonElement>
                | undefined
            }
            aria-label={t`Drag ${fileName} to a line`}
            className="flex-shrink-0 rounded-sm cursor-grab outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <LuGripVertical aria-hidden className="w-4 h-4" />
          </button>
        )}
        <DocumentIcon type={getDocumentType(attachment.name)} />
        <button
          type="button"
          className="font-medium cursor-pointer text-left rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={openFile}
        >
          {isPreviewable ? (
            <DocumentPreview
              bucket="private"
              pathToFile={getPath(attachment)}
              // @ts-expect-error
              type={getDocumentType(attachment.name)}
            >
              {attachment.name}
            </DocumentPreview>
          ) : (
            attachment.name
          )}
        </button>
        {opportunity?.purchaseOrderDocumentPath === getPath(attachment) && (
          <Badge variant="secondary">
            <LuShoppingCart />
          </Badge>
        )}
        {opportunity?.requestForQuoteDocumentPath === getPath(attachment) && (
          <Badge variant="secondary">
            <LuRadioTower />
          </Badge>
        )}
      </HStack>
    </Td>
  );
};

type OpportunityDocumentFormProps = {
  opportunityId: string;
  id: string;
  type: "Sales Order" | "Request for Quote" | "Quote" | "Sales Invoice";
};

export const useOpportunityDocuments = ({
  id,
  opportunityId,
  type
}: OpportunityDocumentFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const { company } = useUser();
  const { carbon } = useCarbon();
  const revalidator = useRevalidator();
  const submit = useSubmit();

  const canDelete = permissions.can("delete", "sales"); // TODO: or is document owner

  const getPath = useCallback(
    (attachment: { name: string }) => {
      return `${
        company.id
      }/opportunity/${opportunityId}/${stripSpecialCharacters(
        attachment.name
      )}`;
    },
    [company.id, opportunityId]
  );

  const deleteAttachment = useCallback(
    async (attachment: FileObject) => {
      if (!carbon) {
        toast.error("Error deleting file");
        return;
      }
      const { error } = await storage(carbon)
        .company(company.id)
        .remove([getPath(attachment)]);

      if (error) {
        toastError("Error deleting file", error);
        return;
      }

      toast.success(t`${attachment.name} deleted successfully`);
      revalidator.revalidate();
    },
    [carbon, getPath, revalidator, t, company.id]
  );

  const download = useCallback(
    async (attachment: FileObject) => {
      const url = path.to.file.previewFile(`private/${getPath(attachment)}`);
      try {
        await downloadUrl(url, attachment.name);
      } catch (error) {
        toastError(t`Error downloading file`, error);
        logger.error("Error", { error: error });
      }
    },
    [getPath, t]
  );

  const createDocumentRecord = useCallback(
    ({
      path: filePath,
      name,
      size
    }: {
      path: string;
      name: string;
      size: number;
    }) => {
      const formData = new FormData();
      formData.append("path", filePath);
      formData.append("name", name);
      formData.append("size", Math.round(size / 1024).toString());
      formData.append("sourceDocument", type);
      formData.append("sourceDocumentId", id);

      submit(formData, {
        method: "post",
        action: path.to.newDocument,
        navigate: false,
        fetcherKey: `opportunity:${name}`
      });
    },
    [id, submit, type]
  );

  const { upload: uploadFiles } = useFileUpload();
  const upload = useCallback(
    async (files: File[]) => {
      await uploadFiles(files, {
        getPath,
        onSuccess: (file, uploadedPath) => {
          toast.success(t`Uploaded: ${file.name}`);
          createDocumentRecord({
            path: uploadedPath,
            name: file.name,
            size: file.size
          });
        }
      });
      revalidator.revalidate();
    },
    [uploadFiles, getPath, createDocumentRecord, revalidator, t]
  );

  return {
    canDelete,
    deleteAttachment,
    download,
    upload,
    getPath
  };
};

const OpportunityDocumentForm = (props: OpportunityDocumentFormProps) => {
  const { company } = useUser();
  const { carbon } = useCarbon();
  const permissions = usePermissions();

  const { upload } = useOpportunityDocuments(props);

  const uploadFiles = async (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && carbon && company) {
      upload(Array.from(e.target.files));
    }
  };

  return (
    <File
      isDisabled={!permissions.can("update", "sales")}
      leftIcon={<LuUpload />}
      onChange={uploadFiles}
      multiple
    >
      <Trans>New</Trans>
    </File>
  );
};

export default OpportunityDocuments;

type OptimisticFileObject = Omit<
  FileObject,
  | "owner"
  | "updated_at"
  | "created_at"
  | "last_accessed_at"
  | "buckets"
  | "metadata"
> & { metadata: { size: number; mimetype: string } };
export const usePendingItems = () => {
  type PendingItem = ReturnType<typeof useFetchers>[number] & {
    formData: FormData;
  };

  return useFetchers()
    .filter((fetcher): fetcher is PendingItem => {
      return fetcher.formAction === path.to.newDocument;
    })
    .reduce<OptimisticFileObject[]>((acc, fetcher) => {
      const path = fetcher.formData.get("path") as string;
      const name = fetcher.formData.get("name") as string;
      const size = parseInt(fetcher.formData.get("size") as string, 10) * 1024;

      if (path && name && size) {
        const newItem: OptimisticFileObject = {
          id: path,
          name: name,
          bucket_id: "private",
          metadata: {
            size,
            mimetype: getDocumentType(name)
          }
        };
        return [...acc, newItem];
      }
      return acc;
    }, []);
};
