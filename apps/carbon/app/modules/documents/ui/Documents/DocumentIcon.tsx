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

const documentIconBaseClass = "flex w-6 h-6 flex-shrink-0";

const DocumentIcon = ({ type, className }: DocumentIconProps) => {
  switch (type) {
    case "Document":
      return (
        <BsFileWordFill
          className={cn(documentIconBaseClass, "text-blue-500", className)}
        />
      );
    case "Spreadsheet":
      return (
        <BsFileExcelFill
          className={cn(documentIconBaseClass, "text-emerald-700", className)}
        />
      );
    case "Presentation":
      return (
        <BsFilePptFill
          className={cn(documentIconBaseClass, "text-orange-400", className)}
        />
      );
    case "PDF":
      return (
        <BsFilePdfFill
          className={cn(documentIconBaseClass, "text-red-600", className)}
        />
      );
    case "Archive":
      return <BsFileZipFill className={cn(documentIconBaseClass, className)} />;
    case "Text":
      return (
        <BsFileTextFill className={cn(documentIconBaseClass, className)} />
      );
    case "Image":
      return (
        <BsFileImageFill
          className={cn(documentIconBaseClass, "text-yellow-400", className)}
        />
      );
    case "Video":
      return (
        <BsFileEarmarkPlayFill
          className={cn(documentIconBaseClass, "text-purple-500", className)}
        />
      );
    case "Audio":
      return (
        <BsFileEarmarkPlayFill
          className={cn(documentIconBaseClass, "text-cyan-400", className)}
        />
      );
    case "Other":
    default:
      return (
        <BsFileEarmarkFill className={cn(documentIconBaseClass, className)} />
      );
  }
};

export default DocumentIcon;
