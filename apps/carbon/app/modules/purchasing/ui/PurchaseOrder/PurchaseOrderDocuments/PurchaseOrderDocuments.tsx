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
import { DocumentPreview } from "~/components";
import { DocumentIcon, getDocumentType } from "~/modules/documents";
import type { PurchaseOrderAttachment } from "~/modules/purchasing";
import PurchaseOrderDocumentForm from "./PurchaseOrderDocumentForm";
import { usePurchaseOrderDocuments } from "./usePurchaseOrderDocuments";

type PurchaseOrderDocumentsProps = {
  attachments: PurchaseOrderAttachment[];
  isExternal: boolean;
  orderId: string;
};

const PurchaseOrderDocuments = ({
  attachments,
  isExternal,
  orderId,
}: PurchaseOrderDocumentsProps) => {
  const { canDelete, download, deleteAttachment, getPath } =
    usePurchaseOrderDocuments({
      isExternal,
      orderId,
    });

  return (
    <>
      <Card>
        <HStack className="justify-between items-start">
          <CardHeader>
            <CardTitle>
              {isExternal ? "External" : "Internal"} Attachments
            </CardTitle>
          </CardHeader>
          <CardAction>
            <PurchaseOrderDocumentForm
              isExternal={isExternal}
              orderId={orderId}
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
                attachments.map((attachment) => {
                  const type = getDocumentType(attachment.name);
                  return (
                    <Tr key={attachment.id}>
                      <Td>
                        <HStack>
                          <DocumentIcon type={type} />
                          <span
                            className="font-medium"
                            onClick={() => download(attachment)}
                          >
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
                          </span>
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

export default PurchaseOrderDocuments;
