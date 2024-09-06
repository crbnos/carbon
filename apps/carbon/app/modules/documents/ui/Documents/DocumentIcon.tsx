import { cn } from "@carbon/react";
import {
  BsFileEarmarkFill,
  BsFileEarmarkPlayFill,
  BsFileExcelFill,
  BsFileImageFill,
  BsFilePdfFill,
  BsFilePptFill,
  BsFileTextFill,
  BsFileWordFill,
  BsFileZipFill,
} from "react-icons/bs";
import type { documentTypes } from "~/modules/documents";

type DocumentIconProps = {
  type: (typeof documentTypes)[number];
  className?: string;
};

const baseIconClasses = "w-6 h-6 flex-shrink-0";

const DocumentIcon = ({ type, className }: DocumentIconProps) => {
  switch (type) {
    case "Document":
      return (
        <BsFileWordFill
          className={cn(baseIconClasses, "text-blue-500", className)}
        />
      );
    case "Spreadsheet":
      return (
        <BsFileExcelFill
          className={cn(baseIconClasses, "text-green-700", className)}
        />
      );
    case "Presentation":
      return (
        <BsFilePptFill
          className={cn(baseIconClasses, "text-orange-400", className)}
        />
      );
    case "PDF":
      return (
        <BsFilePdfFill
          className={cn(baseIconClasses, "text-red-600", className)}
        />
      );
    case "Archive":
      return <BsFileZipFill className={cn(baseIconClasses, className)} />;
    case "Text":
      return <BsFileTextFill className={cn(baseIconClasses, className)} />;
    case "Image":
      return (
        <BsFileImageFill
          className={cn(baseIconClasses, "text-yellow-400", className)}
        />
      );
    case "Video":
      return (
        <BsFileEarmarkPlayFill
          className={cn(baseIconClasses, "text-purple-500", className)}
        />
      );
    case "Audio":
      return (
        <BsFileEarmarkPlayFill
          className={cn(baseIconClasses, "text-cyan-400", className)}
        />
      );
    case "Other":
    default:
      return <BsFileEarmarkFill className={cn(baseIconClasses, className)} />;
  }
};

export default DocumentIcon;
