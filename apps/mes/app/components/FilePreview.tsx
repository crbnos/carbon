import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
  cn,
} from "@carbon/react";
import type { ComponentPropsWithoutRef, ElementRef } from "react";
import { forwardRef } from "react";
import { path } from "~/utils/path";

type FilePreviewProps = ComponentPropsWithoutRef<typeof HoverCardContent> & {
  bucket: "public" | "private";
  pathToFile: string;
  type: "PDF" | "Image";
};

const FilePreview = forwardRef<
  ElementRef<typeof HoverCardContent>,
  FilePreviewProps
>(({ bucket, pathToFile, type, children, className, ...props }, ref) => {
  return (
    <HoverCard>
      <HoverCardTrigger>{children}</HoverCardTrigger>
      {type === "PDF" ? (
        <HoverCardContent
          align="start"
          ref={ref}
          {...props}
          className={cn("w-[425px] h-[550px] overflow-hidden p-0", className)}
        >
          <iframe
            seamless
            title={pathToFile}
            width="425"
            height="550"
            src={path.to.file.previewFile(`${bucket}/${pathToFile}`)}
          />
        </HoverCardContent>
      ) : (
        <HoverCardContent
          align="start"
          className="w-[400px] h-[400px] overflow-hidden p-0 z-[100]"
        >
          <iframe
            seamless
            title={pathToFile}
            width="400"
            height="400"
            src={path.to.file.previewImage(bucket, pathToFile)}
          />
        </HoverCardContent>
      )}
    </HoverCard>
  );
});
FilePreview.displayName = "FilePreview";

export default FilePreview;
