import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
  DropdownMenu,
  DropdownMenuContent,
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
} from "@carbon/react";
import { convertKbToString } from "@carbon/utils";
import { Outlet } from "@remix-run/react";
import type { FileObject } from "@supabase/storage-js";
import { MdMoreVert } from "react-icons/md";
import { DocumentPreview, Hyperlink } from "~/components";
import { DocumentIcon, getDocumentType } from "~/modules/documents";
import SalesRFQDocumentForm from "./SalesRFQDocumentForm";
import { useSalesRFQDocuments } from "./useSalesRFQDocuments";

type SalesRFQDocumentsProps = {
  attachments: FileObject[];
  id: string;
};

const SalesRFQDocuments = ({ attachments, id }: SalesRFQDocumentsProps) => {
  const { canDelete, download, deleteAttachment, getPath } =
    useSalesRFQDocuments({
      id,
    });

  return (
    <>
      <Card>
        <HStack className="justify-between items-start">
          <CardHeader>
            <CardTitle>Documents</CardTitle>
          </CardHeader>
          <CardAction>
            <SalesRFQDocumentForm id={id} />
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
                attachments.map((attachment) => {
                  const type = getDocumentType(attachment.name);
                  return (
                    <Tr key={attachment.id}>
                      <Td>
                        <HStack>
                          <DocumentIcon type={type} />
                          <Hyperlink onClick={() => download(attachment)}>
                            {["PDF", "Image"].includes(type) ? (
                              <DocumentPreview
                                bucket="private"
                                pathToFile={getPath(attachment)}
                                // @ts-ignore
                                type={type}
                              >
                                {attachment.name}
                              </DocumentPreview>
                            ) : (
                              attachment.name
                            )}
                          </Hyperlink>
                        </HStack>
                      </Td>
                      <Td className="text-xs font-mono">
                        {convertKbToString(
                          Math.floor((attachment.metadata?.size ?? 0) / 1024)
                        )}
                      </Td>
                      <Td>
                        <div className="flex justify-end w-full">
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
                  );
                })
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
        </CardContent>
      </Card>
      <Outlet />
    </>
  );
};

export default SalesRFQDocuments;
