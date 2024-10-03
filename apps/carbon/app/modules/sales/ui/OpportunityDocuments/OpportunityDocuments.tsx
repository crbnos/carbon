import { useCarbon } from "@carbon/auth";
import {
  Badge,
  Card,
  CardAction,
  CardContent,
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
import { Outlet, useRevalidator, useSubmit } from "@remix-run/react";
import type { FileObject } from "@supabase/storage-js";
import type { ChangeEvent } from "react";
import { useCallback } from "react";
import {
  LuGripVertical,
  LuRadioTower,
  LuShoppingCart,
  LuUpload,
} from "react-icons/lu";
import { MdMoreVert } from "react-icons/md";
import { DocumentPreview, FileDropzone, Hyperlink } from "~/components";
import { usePermissions, useUser } from "~/hooks";
import { DocumentIcon, getDocumentType } from "~/modules/documents";
import { path } from "~/utils/path";
import type { Opportunity } from "../../types";
import { useOptimisticDocumentDrag } from "../SalesRFQ/useOptimiticDocumentDrag";

type OpportunityDocumentsProps = {
  attachments: FileObject[];
  opportunity: Opportunity;
  id: string;
  type: "Sales Order" | "Request for Quote" | "Quote";
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

  const optimisticData = useOptimisticDocumentDrag();

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      upload(acceptedFiles);
    },
    [upload]
  );

  const DraggableCell = ({ attachment }: { attachment: FileObject }) => {
    const context = useDndContext();
    const { attributes, listeners, setNodeRef, transform } = useDraggable({
      id: attachment.id,
      data: {
        ...attachment,
        path: getPath(attachment),
      },
    });

    const style = transform
      ? {
          transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
          zIndex: 1000,
        }
      : undefined;

    return (
      <Td ref={setNodeRef} style={style} {...attributes} {...listeners}>
        <HStack>
          {context.droppableContainers.size > 0 && <LuGripVertical />}
          <DocumentIcon type={getDocumentType(attachment.name)} />
          <Hyperlink onClick={() => download(attachment)}>
            {["PDF", "Image"].includes(getDocumentType(attachment.name)) ? (
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
          </Hyperlink>
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

  return (
    <>
      <Card>
        <HStack className="justify-between items-start">
          <CardHeader>
            <CardTitle>Files</CardTitle>
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
              {attachments.length ? (
                attachments
                  .filter((d) => d.id !== optimisticData?.id)
                  .map((attachment) => (
                    <Tr key={attachment.id}>
                      <DraggableCell attachment={attachment} />
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
                                icon={<MdMoreVert />}
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

type OpportunityDocumentFormProps = {
  opportunityId: string;
  id: string;
  type: "Sales Order" | "Request for Quote" | "Quote";
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
      return `${company.id}/opportunity/${opportunityId}/${attachment.name}`;
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
      const result = await carbon?.storage
        .from("private")
        .download(getPath(attachment));

      if (!result || result.error) {
        toast.error(result?.error?.message || "Error downloading file");
        return;
      }

      const a = document.createElement("a");
      document.body.appendChild(a);
      const url = window.URL.createObjectURL(result.data);
      a.href = url;
      a.download = attachment.name;
      a.click();

      setTimeout(() => {
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      }, 0);
    },
    [carbon?.storage, getPath]
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
