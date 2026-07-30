import type { JSONContent } from "@carbon/react";
import { tiptapToHTML } from "@carbon/utils";
import { Section, Text } from "@react-email/components";
import { getEmailInlineStyles, getEmailThemeClasses } from "./Theme";

/**
 * Renders a document's top-level external notes (Tiptap rich text) directly in
 * the email body, mirroring the "Notes" block shown in the attached PDF so the
 * recipient sees them without opening the attachment. Renders nothing when there
 * are no external notes. Only external notes are ever passed here — internal
 * notes must never reach the customer/supplier.
 */
const ExternalNotes = ({ content }: { content: unknown }) => {
  const html = tiptapToHTML(content as JSONContent | null | undefined);
  // tiptapToHTML returns "" for empty/absent docs; also skip notes that are only
  // empty markup (e.g. a single blank paragraph) so we don't render a bare label.
  if (!html || html.replace(/<[^>]*>/g, "").trim() === "") return null;

  const themeClasses = getEmailThemeClasses();
  const lightStyles = getEmailInlineStyles("light");

  return (
    <Section className="mb-4">
      <Text
        className={`uppercase text-[10px] ${themeClasses.mutedText}`}
        style={{ color: lightStyles.mutedText.color }}
      >
        Notes
      </Text>
      <div
        className={`text-sm ${themeClasses.text}`}
        style={{ color: lightStyles.text.color }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </Section>
  );
};

export default ExternalNotes;
