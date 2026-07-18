import { Section, Text } from "@react-email/components";

interface ExternalNotesProps {
  content?: string | null;
}

const ExternalNotes = ({ content }: ExternalNotesProps) => {
  if (!content) return null;

  return (
    <Section className="mb-4 p-4 bg-blue-50 rounded-lg border border-blue-200">
      <Text className="text-sm font-semibold text-blue-900 mb-2">Notes</Text>
      <Text className="text-sm text-blue-800 whitespace-pre-wrap">
        {content}
      </Text>
    </Section>
  );
};

export default ExternalNotes;
