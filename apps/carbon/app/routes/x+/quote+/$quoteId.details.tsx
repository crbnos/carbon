import { VStack } from "@carbon/react";
import { useParams } from "@remix-run/react";
import { QuoteDocuments, QuoteForm } from "~/modules/sales";

export default function QuoteDetailsRoute() {
  const { quoteId } = useParams();
  if (!quoteId) throw new Error("Could not find quoteId");
  const initialValues = {
    id: "1",
  };

  return (
    <VStack spacing={2} className="p-2">
      <QuoteForm key={initialValues.id} initialValues={initialValues} />
      <QuoteDocuments id={quoteId} attachments={[]} isExternal={false} />
    </VStack>
  );
}
