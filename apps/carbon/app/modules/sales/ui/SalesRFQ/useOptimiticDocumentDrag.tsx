import { useFetchers, useParams } from "@remix-run/react";
import { path } from "~/utils/path";
import { salesRfqDragValidator } from "../../sales.models";

export function useOptimisticDocumentDrag() {
  const { rfqId } = useParams();
  const fetchers = useFetchers();

  if (!rfqId) return null;

  const relevantFetcher = fetchers.find(
    (fetcher) => fetcher.formAction === path.to.salesRfqDrag(rfqId)
  );

  const payload = relevantFetcher?.formData?.get("payload");
  if (payload) {
    try {
      const parsedPayload = salesRfqDragValidator.safeParse(
        JSON.parse(payload as string)
      );
      if (parsedPayload.success) {
        return parsedPayload.data;
      }
    } catch {
      // nothing
    }
  }

  return null;
}
