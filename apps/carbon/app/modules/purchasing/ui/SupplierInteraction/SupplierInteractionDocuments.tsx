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
  LuMoreVertical,
  LuRadioTower,
  LuShoppingCart,
  LuUpload,
} from "react-icons/lu";
import { DocumentPreview, FileDropzone } from "~/components";
import { usePermissions, useUser } from "~/hooks";
import { DocumentIcon, getDocumentType } from "~/modules/documents";
import { path } from "~/utils/path";
import { stripSpecialCharacters } from "~/utils/string";
import type { SupplierInteraction } from "../../types";

type SupplierInteractionDocumentsProps = {
  attachments: FileObject[];
  interaction: SupplierInteraction;
  id: string;
  type: "Supplier Quote" | "Purchase Order";
};

const SupplierInteractionDocuments = ({
  attachments,
  interaction,
  id,
  type,
}: SupplierInteractionDocumentsProps) => {
  const { canDelete, download, deleteAttachment, getPath, upload } =
    useSupplierInteractionDocuments({
      interactionId: interaction.id,
      id,
      type,
    });

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      upload(acceptedFiles);
    },
    [upload]
  );

  return (
    <>
      <Card>
        <HStack className="justify-between items-start">
          <CardHeader>
            <CardTitle>Files</CardTitle>
          </CardHeader>
          <CardAction>
            <SupplierInteractionDocumentForm
              interactionId={interaction.id}
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
                attachments.map((attachment) => (
                  <Tr key={attachment.id}>
                    <Td>
                      <HStack>
                        <DocumentIcon type={getDocumentType(attachment.name)} />
                        <span
                          className="font-medium"
                          onClick={() => download(attachment)}
                        >
                          {["PDF", "Image"].includes(
                            getDocumentType(attachment.name)
                          ) ? (
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
                        {interaction?.salesOrderDocumentPath ===
                          getPath(attachment) && (
                          <Badge variant="secondary">
                            <LuShoppingCart />
                          </Badge>
                        )}
                        {interaction?.quoteDocumentPath ===
                          getPath(attachment) && (
                          <Badge variant="secondary">
                            <LuRadioTower />
                          </Badge>
                        )}
                      </HStack>
                    </Td>
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
                              icon={<LuMoreVertical />}
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

type SupplierInteractionDocumentFormProps = {
  interactionId: string;
  id: string;
  type: "Supplier Quote" | "Purchase Order";
};

export const useSupplierInteractionDocuments = ({
  id,
  interactionId,
  type,
}: SupplierInteractionDocumentFormProps) => {
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
      }/supplier-interaction/${interactionId}/${stripSpecialCharacters(
        attachment.name
      )}`;
    },
    [company.id, interactionId]
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
        navigate: false,
        fetcherKey: `interaction:${name}`,
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

const SupplierInteractionDocumentForm = (
  props: SupplierInteractionDocumentFormProps
) => {
  const { company } = useUser();
  const { carbon } = useCarbon();
  const permissions = usePermissions();

  const { upload } = useSupplierInteractionDocuments(props);

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

export default SupplierInteractionDocuments;

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
