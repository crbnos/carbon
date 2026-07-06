import { useCarbon } from "@carbon/auth";
import {
  Card,
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
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  toast
} from "@carbon/react";
import { convertKbToString } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import type { FileObject } from "@supabase/storage-js";
import type { ReactNode } from "react";
import { useCallback, useState } from "react";
import { LuDownload, LuEllipsisVertical, LuTrash } from "react-icons/lu";
import { useRevalidator } from "react-router";
import DocumentIcon from "~/components/DocumentIcon";
import DocumentPreview from "~/components/DocumentPreview";
import FileDropzone from "~/components/FileDropzone";
import { useDateFormatter, useUser } from "~/hooks";
import { getDocumentType } from "~/modules/shared";
import { path } from "~/utils/path";
import { stripSpecialCharacters } from "~/utils/string";

type Props = {
  files: FileObject[];
  storagePathPrefix: string;
  title: ReactNode;
  description: ReactNode;
};

const PREVIEWABLE = new Set(["PDF", "Image"]);

export default function DefaultAttachmentsPanel({
  files,
  storagePathPrefix,
  title,
  description
}: Props) {
  const { t } = useLingui();
  const { formatDate } = useDateFormatter();
  const { carbon } = useCarbon();
  const { company } = useUser();
  const revalidator = useRevalidator();
  const [deletingPath, setDeletingPath] = useState<string | null>(null);

  const fullPath = useCallback(
    (name: string) => `${company.id}/${storagePathPrefix}/${name}`,
    [company.id, storagePathPrefix]
  );

  const onDrop = useCallback(
    async (acceptedFiles: File[]) => {
      if (!carbon) {
        toast.error(t`Storage client not available`);
        return;
      }
      for (const file of acceptedFiles) {
        const safeName = stripSpecialCharacters(file.name);
        const upload = await carbon.storage
          .from("private")
          .upload(fullPath(safeName), file, {
            cacheControl: `${12 * 60 * 60}`,
            upsert: true
          });
        if (upload.error) toast.error(t`Failed to upload ${file.name}`);
      }
      revalidator.revalidate();
    },
    [carbon, fullPath, revalidator, t]
  );

  const onDownload = useCallback(
    async (name: string) => {
      const url = path.to.file.previewFile(`private/${fullPath(name)}`);
      try {
        const response = await fetch(url);
        const blob = await response.blob();
        const blobUrl = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        document.body.appendChild(a);
        a.href = blobUrl;
        a.download = name;
        a.click();
        window.URL.revokeObjectURL(blobUrl);
        document.body.removeChild(a);
      } catch (err) {
        toast.error(t`Error downloading file`);
        console.error(err);
      }
    },
    [fullPath, t]
  );

  const onDelete = useCallback(
    async (name: string) => {
      if (!carbon) {
        toast.error(t`Storage client not available`);
        return;
      }
      const storagePath = fullPath(name);
      setDeletingPath(storagePath);
      try {
        const result = await carbon.storage
          .from("private")
          .remove([storagePath]);
        if (result.error) {
          toast.error(result.error.message || t`Error deleting file`);
        } else {
          toast.success(t`${name} deleted`);
          revalidator.revalidate();
        }
      } finally {
        setDeletingPath(null);
      }
    },
    [carbon, fullPath, revalidator, t]
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <Table className="w-full table-fixed">
          <Thead>
            <Tr>
              <Th className="w-auto">
                <Trans>Name</Trans>
              </Th>
              <Th className="w-24">
                <Trans>Size</Trans>
              </Th>
              <Th className="w-32">
                <Trans>Created</Trans>
              </Th>
              <Th className="w-12"></Th>
            </Tr>
          </Thead>
          <Tbody>
            {files
              .slice()
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((f) => {
                const type = getDocumentType(f.name);
                const isPreviewable = PREVIEWABLE.has(type);
                const filePath = fullPath(f.name);
                const sizeKb =
                  f.metadata?.size != null
                    ? Math.round(f.metadata.size / 1024)
                    : null;

                return (
                  <Tr key={f.name}>
                    <Td className="max-w-0">
                      <HStack className="gap-2 min-w-0 w-full">
                        <DocumentIcon type={type} />
                        <span
                          className="font-medium truncate cursor-pointer min-w-0 flex-1"
                          onClick={() => {
                            if (isPreviewable) {
                              window.open(
                                path.to.file.previewFile(`private/${filePath}`),
                                "_blank"
                              );
                            } else {
                              onDownload(f.name);
                            }
                          }}
                        >
                          {isPreviewable ? (
                            <DocumentPreview
                              bucket="private"
                              pathToFile={filePath}
                              // @ts-ignore — type is a string union the preview accepts
                              type={type}
                            >
                              {f.name}
                            </DocumentPreview>
                          ) : (
                            f.name
                          )}
                        </span>
                      </HStack>
                    </Td>
                    <Td className="text-xs font-mono whitespace-nowrap">
                      {sizeKb != null ? convertKbToString(sizeKb) : "--"}
                    </Td>
                    <Td className="text-xs font-mono whitespace-nowrap">
                      {f.created_at ? formatDate(f.created_at) : "--"}
                    </Td>
                    <Td>
                      <div className="flex justify-end w-full">
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
                              onClick={() => onDownload(f.name)}
                            >
                              <DropdownMenuIcon icon={<LuDownload />} />
                              <Trans>Download</Trans>
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              destructive
                              disabled={deletingPath === filePath}
                              onClick={() => onDelete(f.name)}
                            >
                              <DropdownMenuIcon icon={<LuTrash />} />
                              <Trans>Delete</Trans>
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </Td>
                  </Tr>
                );
              })}
            {files.length === 0 && (
              <Tr>
                <Td
                  colSpan={4}
                  className="py-8 text-muted-foreground text-center"
                >
                  <Trans>No default attachments yet.</Trans>
                </Td>
              </Tr>
            )}
          </Tbody>
        </Table>

        <FileDropzone onDrop={onDrop} />
      </CardContent>
    </Card>
  );
}
