import type { JSONContent } from "@carbon/react";
import { Document, Page, StyleSheet, View } from "@react-pdf/renderer";
import { type PropsWithChildren, useMemo } from "react";
import { DEFAULT_THEME, type DocumentTheme } from "../../template";
import type { Meta } from "../../types";
import { DocStyleProvider, makeDocTw } from "../blocks/tw";
import { getSafeFontFamily } from "../fonts";
import Footer from "./Footer";
import Note from "./Note";

type TemplateProps = PropsWithChildren<{
  title: string;
  meta: Meta;
  footerLabel?: string;
  footerDocumentId?: string | null;
  /** When false, the entire footer band (registration line + page numbers) is omitted. */
  showFooter?: boolean;
  showPageNumbers?: boolean;
  pageNumberFormat?: "pageOfTotal" | "page";
  showRegistrationLine?: boolean;
  /** Body font (Inter is registered; the rest are PDF standard fonts). */
  fontFamily?: string;
  /** Shared-section content repeated at the top of every page. */
  headerContent?: JSONContent | null;
  /** Shared-section content repeated in the footer of every page. */
  footerContent?: JSONContent | null;
  /** Document theme — drives the block palette (headings, body text). */
  theme?: DocumentTheme;
}>;

const Template = ({
  title,
  meta,
  footerLabel,
  footerDocumentId,
  showFooter = true,
  showPageNumbers = true,
  pageNumberFormat = "pageOfTotal",
  showRegistrationLine = true,
  fontFamily = "Inter",
  headerContent,
  footerContent,
  theme = DEFAULT_THEME,
  children
}: TemplateProps) => {
  const docStyle = useMemo(() => ({ tw: makeDocTw(theme), theme }), [theme]);
  const hasHeader =
    headerContent &&
    typeof headerContent === "object" &&
    Array.isArray(headerContent.content) &&
    headerContent.content.length > 0;
  const safeFontFamily = getSafeFontFamily(fontFamily);

  const styles = StyleSheet.create({
    body: {
      fontFamily: safeFontFamily,
      // Unitless line-height = a multiple of font size, so vertical rhythm is
      // identical for every font (Inter, serif, mono) and every text size.
      // letterSpacing 0 drops each font's default tracking for consistency.
      lineHeight: 1.4,
      letterSpacing: 0,
      padding: "10px 16px 36px 16px",
      color: "#000000",
      backgroundColor: "#FFFFFF"
    }
  });

  return (
    <Document
      author={meta?.author ?? "Carbon"}
      keywords={meta?.keywords}
      subject={meta?.subject}
      title={title}
    >
      <Page size="A4" style={styles.body}>
        <DocStyleProvider value={docStyle}>
          {hasHeader && (
            <View fixed style={{ marginBottom: 8 }}>
              <Note content={headerContent} />
            </View>
          )}
          {children}
          {showFooter && (
            <Footer
              label={footerLabel}
              documentId={footerDocumentId}
              content={footerContent}
              showPageNumbers={showPageNumbers}
              pageNumberFormat={pageNumberFormat}
              showRegistrationLine={showRegistrationLine}
            />
          )}
        </DocStyleProvider>
      </Page>
    </Document>
  );
};

export default Template;
