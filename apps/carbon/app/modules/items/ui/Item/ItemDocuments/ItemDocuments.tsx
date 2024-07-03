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
import { LuAxis3D } from "react-icons/lu";
import { MdMoreVert } from "react-icons/md";
import { DocumentPreview, Hyperlink } from "~/components";
import { DocumentIcon, getDocumentType } from "~/modules/documents";
import type { ItemFile, MethodItemType, ModelUpload } from "~/modules/items";
import ItemDocumentForm from "./ItemDocumentForm";
import { useItemDocuments } from "./useItemDocuments";

type ItemDocumentsProps = {
  files: ItemFile[];
  itemId: string;
  modelUpload?: ModelUpload;
  type: MethodItemType;
};

const ItemDocuments = ({
  files,
  itemId,
  modelUpload,
  type,
}: ItemDocumentsProps) => {
  const { canDelete, download, deleteFile, deleteModel, getPath, viewModel } =
    useItemDocuments({
      itemId,
    });

  return (
    <Card className="flex-grow">
      <HStack className="justify-between items-start">
        <CardHeader>
          <CardTitle>Files</CardTitle>
        </CardHeader>
        <CardAction>
          <ItemDocumentForm type={type} itemId={itemId} />
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
            {modelUpload && (
              <Tr>
                <Td>
                  <HStack>
                    <LuAxis3D className="text-green-500 w-6 h-6" />
                    <Hyperlink
                      target="_blank"
                      onClick={() => viewModel(modelUpload)}
                    >
                      {modelUpload?.autodeskUrn
                        ? modelUpload.name
                        : "Uploading..."}
                    </Hyperlink>
                  </HStack>
                </Td>
                <Td>
                  {modelUpload.size
                    ? convertKbToString(
                        Math.floor((modelUpload.size ?? 0) / 1024)
                      )
                    : "--"}
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
                          onClick={() => viewModel(modelUpload)}
                        >
                          View
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          disabled={!canDelete}
                          onClick={() => deleteModel(modelUpload)}
                        >
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </Td>
              </Tr>
            )}
            {files.map((file) => {
              const type = getDocumentType(file.name);
              return (
                <Tr key={file.id}>
                  <Td>
                    <HStack>
                      <DocumentIcon type={type} />
                      <Hyperlink onClick={() => download(file)}>
                        {["PDF", "Image"].includes(type) ? (
                          <DocumentPreview
                            bucket="private"
                            pathToFile={getPath(file)}
                            // @ts-ignore
                            type={type}
                          >
                            {file.name}
                          </DocumentPreview>
                        ) : (
                          file.name
                        )}
                      </Hyperlink>
                    </HStack>
                  </Td>
                  <Td>
                    {convertKbToString(
                      Math.floor((file.metadata?.size ?? 0) / 1024)
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
                          <DropdownMenuItem onClick={() => download(file)}>
                            Download
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            disabled={!canDelete}
                            onClick={() => deleteFile(file)}
                          >
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </Td>
                </Tr>
              );
            })}
            {files.length === 0 && !modelUpload && (
              <Tr>
                <Td
                  colSpan={24}
                  className="py-8 text-muted-foreground text-center"
                >
                  No files
                </Td>
              </Tr>
            )}
          </Tbody>
        </Table>
      </CardContent>
    </Card>
  );
};

export default ItemDocuments;
