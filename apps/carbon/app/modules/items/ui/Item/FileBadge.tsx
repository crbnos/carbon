import { Badge, HStack, cn } from "@carbon/react";
import { LuDownload } from "react-icons/lu";
import { DocumentPreview } from "~/components";
import DocumentIcon from "~/components/DocumentIcon";
import type { MethodItemType } from "~/modules/shared";
import { getDocumentType } from "~/modules/shared";
import type { ItemFile } from "../../types";
import { useItemDocuments } from "./ItemDocuments";

type FileBadgeProps = {
  file: ItemFile;
  itemId: string;
  itemType: MethodItemType;
  className?: string;
};

export function FileBadge({
  file,
  itemId,
  itemType,
  className,
}: FileBadgeProps) {
  const { getPath, download } = useItemDocuments({ itemId, type: itemType });
  const type = getDocumentType(file.name);
  return (
    <HStack className="group" spacing={1}>
      {["PDF", "Image"].includes(type) ? (
        <DocumentPreview
          bucket="private"
          pathToFile={getPath(file)}
          // @ts-ignore
          type={type}
        >
          <Badge variant="secondary" className={cn("max-w-[240px]", className)}>
            <DocumentIcon type={type} className="flex-shrink-0 w-3 h-3 mr-1" />
            {file.name}
          </Badge>
        </DocumentPreview>
      ) : (
        <Badge variant="secondary" className={cn("max-w-[240px]", className)}>
          <DocumentIcon type={type} className="flex-shrink-0 w-3 h-3 mr-1" />
          {file.name}
        </Badge>
      )}

      <LuDownload
        onClick={() => download(file)}
        className="cursor-pointer group-hover:opacity-100 opacity-0 transition-opacity duration-200 w-4 h-4 text-foreground"
      />
    </HStack>
  );
}
