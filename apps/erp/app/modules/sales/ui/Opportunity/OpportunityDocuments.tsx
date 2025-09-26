import { useCarbon } from "@carbon/auth";
import {
  Badge,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  File,
  HStack,
  IconButton,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  toast,
} from "@carbon/react";
import { convertKbToString } from "@carbon/utils";
import { useDndContext, useDraggable } from "@dnd-kit/core";
import {
  Outlet,
  useFetchers,
  useRevalidator,
  useSubmit,
} from "@remix-run/react";
import type { FileObject } from "@supabase/storage-js";
import type { ChangeEvent } from "react";
import { useCallback } from "react";
import {
  LuEllipsisVertical,
  LuGripVertical,
  LuRadioTower,
  LuShoppingCart,
  LuUpload,
} from "react-icons/lu";
import { DocumentPreview, FileDropzone } from "~/components";
import DocumentIcon from "~/components/DocumentIcon";
import { usePermissions, useUser } from "~/hooks";
import { getDocumentType } from "~/modules/shared";
import { path } from "~/utils/path";
import { stripSpecialCharacters } from "~/utils/string";
import type { Opportunity } from "../../types";
import { useOptimisticDocumentDrag } from "../SalesRFQ/useOptimiticDocumentDrag";

type OpportunityDocumentsProps = {
  attachments: FileObject[];
  opportunity: Opportunity;
  id: string;
  type: "Sales Order" | "Request for Quote" | "Quote" | "Sales Invoice";
};

const OpportunityDocuments = ({
  attachments,
  opportunity,
  id,
  type,
}: OpportunityDocumentsProps) => {
  const { canDelete, download, deleteAttachment, getPath, upload } =
    useOpportunityDocuments({
      opportunityId: opportunity.id,
      id,
      type,
    });

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
            <CardTitle>Files</CardTitle>
            <CardDescription>Opportunity documents</CardDescription>
          </CardHeader>
          <CardAction>
            <OpportunityDocumentForm
              opportunityId={opportunity.id}
              id={id}
              type={type}
            />
          </CardAction>
        </HStack>
        <CardContent>
          <Table>
            <Thead>
              <Tr>
                <Th>Name</Th>
                <Th>Size</Th>
                <Th></Th>
              </Tr>
            </Thead>
            <Tbody>
              {attachmentsToRender.length ? (
                attachmentsToRender.map((attachment) => (
                  <Tr key={attachment.id}>
                    <DraggableCell
                      attachment={attachment}
                      opportunity={opportunity}
                      download={download}
                      getPath={getPath}
                    />
                    <Td className="text-xs font-mono">
                      {convertKbToString(
                        Math.floor((attachment.metadata?.size ?? 0) / 1024)
                      )}
                    </Td>
                    <Td>
                      <div className="flex justify-end gap-2">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <IconButton
                              aria-label="More"
                              icon={<LuEllipsisVertical />}
                              variant="secondary"
                            />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent>
                            <DropdownMenuItem
                              onClick={() => download(attachment)}
                            >
                              Download
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              destructive
                              disabled={!canDelete}
                              onClick={() => deleteAttachment(attachment)}
                            >
                              Delete
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
                    No files uploaded
                  </Td>
                </Tr>
              )}
            </Tbody>
          </Table>
          <FileDropzone onDrop={onDrop} />
        </CardContent>
      </Card>

      <Outlet />
    </>
  );
};

const DraggableCell = ({
  attachment,
  opportunity,
  download,
  getPath,
}: {
  attachment: FileObject;
  opportunity: Opportunity;
  download: (attachment: FileObject) => void;
  getPath: (attachment: FileObject) => string;
}) => {
  const context = useDndContext();
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: attachment.id,
    data: {
      id: attachment.id,
      name: attachment.name,
      size: attachment.metadata?.size || 0,
      path: getPath(attachment),
      type: "opportunityDocument",
    },
  });

  const style = transform
    ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
        zIndex: 1000,
      }
    : undefined;

  const isPreviewable = ["PDF", "Image"].includes(
    getDocumentType(attachment.name)
  );

  return (
    <Td ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <HStack>
        {context.droppableContainers.size > 0 && (
          <LuGripVertical className="w-4 h-4 flex-shrink-0" />
        )}
        <DocumentIcon type={getDocumentType(attachment.name)} />
        <span
          className="font-medium cursor-pointer"
          onClick={() => {
            if (isPreviewable) {
              window.open(
                path.to.file.previewFile(`private/${getPath(attachment)}`),
                "_blank"
              );
            } else {
              download(attachment);
            }
          }}
        >
          {isPreviewable ? (
            <DocumentPreview
              bucket="private"
              pathToFile={getPath(attachment)}
              // @ts-ignore
              type={getDocumentType(attachment.name)}
            >
              {attachment.name}
            </DocumentPreview>
          ) : (
            attachment.name
          )}
        </span>
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
  type,
}: OpportunityDocumentFormProps) => {
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
      const result = await carbon?.storage
        .from("private")
        .remove([getPath(attachment)]);

      if (!result || result.error) {
        toast.error(result?.error?.message || "Error deleting file");
        return;
      }

      toast.success(`${attachment.name} deleted successfully`);
      revalidator.revalidate();
    },
    [carbon?.storage, getPath, revalidator]
  );

  const download = useCallback(
    async (attachment: FileObject) => {
      const url = path.to.file.previewFile(`private/${getPath(attachment)}`);
      try {
        const response = await fetch(url);
        const blob = await response.blob();
        const blobUrl = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        document.body.appendChild(a);
        a.href = blobUrl;
        a.download = attachment.name;
        a.click();
        window.URL.revokeObjectURL(blobUrl);
        document.body.removeChild(a);
      } catch (error) {
        toast.error("Error downloading file");
        console.error(error);
      }
    },
    [getPath]
  );

  const createDocumentRecord = useCallback(
    ({
      path: filePath,
      name,
      size,
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
        fetcherKey: `opportunity:${name}`,
      });
    },
    [id, submit, type]
  );

  const upload = useCallback(
    async (files: File[]) => {
      if (!carbon) {
        toast.error("Carbon client not available");
        return;
      }

      for (const file of files) {
        const fileName = getPath(file);
        toast.info(`Uploading ${file.name}`);

        const fileUpload = await carbon.storage
          .from("private")
          .upload(fileName, file, {
            cacheControl: `${12 * 60 * 60}`,
            upsert: true,
          });

        if (fileUpload.error) {
          toast.error(`Failed to upload file: ${file.name}`);
        } else if (fileUpload.data?.path) {
          toast.success(`Uploaded: ${file.name}`);
          createDocumentRecord({
            path: fileUpload.data.path,
            name: file.name,
            size: file.size,
          });
        }
      }
      revalidator.revalidate();
    },
    [getPath, createDocumentRecord, carbon, revalidator]
  );

  return {
    canDelete,
    deleteAttachment,
    download,
    upload,
    getPath,
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
      New
    </File>
  );
};

export default OpportunityDocuments;

type OptimisticFileObject = Omit<
  FileObject,
  "owner" | "updated_at" | "created_at" | "last_accessed_at" | "buckets"
>;
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
            mimetype: getDocumentType(name),
          },
        };
        return [...acc, newItem];
      }
      return acc;
    }, []);
};
