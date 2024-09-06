import { useFetchers, useParams } from "@remix-run/react";
import { path } from "~/utils/path";

export function useOptimisticDocumentDrag() {
  const { rfqId } = useParams();
  if (!rfqId) throw new Error("rfqId not found");
  const fetchers = useFetchers();

  const relevantFetcher = fetchers.find(
    (fetcher) => fetcher.formAction === path.to.salesRfqDrag(rfqId)
  );

  const payload = relevantFetcher?.formData?.get("payload");
  if (payload) {
    return JSON.parse(payload as string);
  }

  return null;
}
