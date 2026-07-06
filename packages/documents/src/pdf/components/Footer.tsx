import type { JSONContent } from "@carbon/react";
import { Text, View } from "@react-pdf/renderer";
import { createTw } from "react-pdf-tailwind";
import Note from "./Note";

const tw = createTw({
  theme: {
    fontFamily: {
      sans: ["Helvetica", "Arial", "sans-serif"]
    }
  }
});

interface FooterProps {
  label?: string;
  documentId?: string | null;
  /** Optional shared-section content rendered above the registration line. */
  content?: JSONContent | null;
  /** Document settings (default: show everything). */
  showPageNumbers?: boolean;
  pageNumberFormat?: "pageOfTotal" | "page";
  showRegistrationLine?: boolean;
}

const Footer = ({
  label,
  documentId,
  content,
  showPageNumbers = true,
  pageNumberFormat = "pageOfTotal",
  showRegistrationLine = true
}: FooterProps) => {
  const hasContent =
    content &&
    typeof content === "object" &&
    Array.isArray(content.content) &&
    content.content.length > 0;

  return (
    <View
      style={[
        tw("absolute bottom-0 left-0 right-0 pb-5"),
        { paddingLeft: 16, paddingRight: 16 }
      ]}
      fixed
    >
      {hasContent && (
        <View style={tw("text-[8px] text-gray-500 mb-2 px-1")}>
          <Note content={content} />
        </View>
      )}
      <View style={tw("border-t border-gray-200 pt-3")}>
        <View
          style={tw(
            "flex flex-row justify-between items-center text-xs text-gray-500 px-1"
          )}
        >
          <Text>{showRegistrationLine ? (label ?? "") : ""}</Text>
          {showPageNumbers && (
            <Text
              render={({ pageNumber, totalPages }) =>
                `${documentId ? `${documentId}   ` : ""}Page ${pageNumber}${
                  pageNumberFormat === "pageOfTotal" ? ` of ${totalPages}` : ""
                }`
              }
            />
          )}
        </View>
      </View>
    </View>
  );
};

export default Footer;
