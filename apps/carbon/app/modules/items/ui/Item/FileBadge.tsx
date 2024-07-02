import { Badge, HStack, cn } from "@carbon/react";
import { LuDownload } from "react-icons/lu";
import { DocumentPreview } from "~/components";
import { DocumentIcon, getDocumentType } from "~/modules/documents";
import type { ItemFile } from "../../types";
import { useItemDocuments } from "./ItemDocuments/useItemDocuments";

type FileBadgeProps = {
  file: ItemFile;
  itemId: string;
  className?: string;
};

export function FileBadge({ file, itemId, className }: FileBadgeProps) {
  const { getPath, download } = useItemDocuments({ itemId });
  const type = getDocumentType(file.name);
  return (
    <HStack className="group" spacing={1}>
      <Badge variant="secondary" className={cn(className)}>
        <DocumentIcon type={type} className="w-3 h-3 mr-1" />

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
      </Badge>

      <LuDownload
        onClick={() => download(file)}
        className="cursor-pointer group-hover:opacity-100 opacity-0 transition-opacity duration-200 w-4 h-4 text-foreground"
      />
    </HStack>
  );
}
