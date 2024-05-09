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

const DocumentIcon = ({ type, className }: DocumentIconProps) => {
  switch (type) {
    case "Document":
      return (
        <BsFileWordFill className={cn("w-6 h-6 text-blue-500", className)} />
      );
    case "Spreadsheet":
      return (
        <BsFileExcelFill className={cn("w-6 h-6 text-green-700", className)} />
      );
    case "Presentation":
      return (
        <BsFilePptFill className={cn("w-6 h-6 text-orange-400", className)} />
      );
    case "PDF":
      return (
        <BsFilePdfFill className={cn("w-6 h-6 text-red-600", className)} />
      );
    case "Archive":
      return <BsFileZipFill className={cn("w-6 h-6", className)} />;
    case "Text":
      return <BsFileTextFill className={cn("w-6 h-6", className)} />;
    case "Image":
      return (
        <BsFileImageFill className={cn("w-6 h-6 text-yellow-400", className)} />
      );
    case "Video":
      return (
        <BsFileEarmarkPlayFill
          className={cn("w-6 h-6 text-purple-500", className)}
        />
      );
    case "Audio":
      return (
        <BsFileEarmarkPlayFill
          className={cn("w-6 h-6 text-cyan-400", className)}
        />
      );
    case "Other":
    default:
      return <BsFileEarmarkFill className={cn("w-6 h-6", className)} />;
  }
};

export default DocumentIcon;
