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
import { MdMoreVert } from "react-icons/md";
import { DocumentPreview, Hyperlink } from "~/components";
import { DocumentIcon, getDocumentType } from "~/modules/documents";
import type { QuotationAttachment } from "~/modules/sales";
import QuoteDocumentForm from "./QuoteDocumentForm";
import { useQuoteDocuments } from "./useQuoteDocuments";

type QuoteDocumentsProps = {
  attachments: QuotationAttachment[];
  isExternal: boolean;
  id: string;
};

const QuoteDocuments = ({
  attachments,
  isExternal,
  id,
}: QuoteDocumentsProps) => {
  const { canDelete, download, deleteAttachment, getPath } = useQuoteDocuments({
    isExternal,
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
            <QuoteDocumentForm isExternal={false} id={id} />
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
                      <Td>
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
                    No {isExternal ? "external" : "internal"} attachments
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

export default QuoteDocuments;
