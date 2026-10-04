// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useChangedRows } from "@carbon/query";
import { useCarbon } from "@carbon/react";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  DocumentExtractionType,
  ExtractedDocumentData
} from "~/modules/documents";
import { parseExtractedData } from "~/modules/documents";
import { useUser } from "./useUser";

type ExtractionStatus = "pending" | "processing" | "completed" | "failed";

type DocumentExtractionState = {
  id: string;
  status: ExtractionStatus;
  filteredData: ExtractedDocumentData | null;
  error: string | null;
  storagePath: string | null;
};

const TERMINAL_STATUSES: ExtractionStatus[] = ["completed", "failed"];
const POLL_INTERVAL_MS = 3_000;

/**
 * Subscribes to realtime updates on a documentExtraction row.
 * Returns the latest extraction state, including the filtered
 * (confidence-gated) data once completed.
 *
 * Uses two complementary strategies:
 *  1. A realtime broadcast — instant push when available.
 *  2. Polling fallback every 3 s while extraction is in-progress — ensures
 *     the UI never stalls if the realtime event is missed or the channel
 *     takes time to subscribe.
 */
export function useDocumentExtraction(
  extractionId: string | null,
  documentType: DocumentExtractionType
) {
  const { company } = useUser();
  const { carbon: supabase } = useCarbon();
  const [extraction, setExtraction] = useState<DocumentExtractionState | null>(
    null
  );
  const [isLoading, setIsLoading] = useState(false);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearPoll = useCallback(() => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  // Fetch latest row and schedule next poll if still in-progress
  const fetchInitial = useCallback(async () => {
    if (!extractionId || !supabase) return;
    setIsLoading(true);
    const { data } = await supabase
      .from("documentExtraction")
      .select("id, status, filteredData, error, storagePath")
      .eq("id", extractionId)
      .single();

    if (data) {
      const row: DocumentExtractionState = {
        id: data.id,
        status: data.status as ExtractionStatus,
        filteredData: data.filteredData
          ? parseExtractedData(documentType, data.filteredData)
          : null,
        error: data.error,
        storagePath: data.storagePath
      };
      setExtraction(row);

      // Schedule next poll if extraction is still in-progress
      if (!TERMINAL_STATUSES.includes(row.status)) {
        clearPoll();
        pollTimerRef.current = setTimeout(() => {
          pollTimerRef.current = null;
          void fetchInitial();
        }, POLL_INTERVAL_MS);
      } else {
        clearPoll();
      }
    }
    setIsLoading(false);
  }, [extractionId, supabase, clearPoll, documentType]);

  // Stop polling when we get a terminal status via realtime
  const handleRealtimeUpdate = useCallback(
    (row: DocumentExtractionState) => {
      setExtraction(row);
      if (TERMINAL_STATUSES.includes(row.status)) {
        clearPoll();
      }
    },
    [clearPoll]
  );

  // Cleanup polling on unmount
  useEffect(() => {
    return () => clearPoll();
  }, [clearPoll]);

  // Subscribe to realtime changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: load once per extraction (also starts polling if in-progress)
  useEffect(() => {
    fetchInitial();
  }, [extractionId, company.id]);

  useChangedRows<{
    id: string;
    status: ExtractionStatus;
    filteredData: unknown;
    error: string | null;
    storagePath: string | null;
  }>({
    companyId: company.id,
    table: "documentExtraction",
    columns: "id, status, filteredData, error, storagePath",
    enabled: !!extractionId,
    onResync: fetchInitial,
    onChange: ({ rows }) => {
      const row = rows.find((r) => r.id === extractionId);
      if (!row) return;
      handleRealtimeUpdate({
        id: row.id,
        status: row.status,
        filteredData: row.filteredData
          ? parseExtractedData(documentType, row.filteredData)
          : null,
        error: row.error,
        storagePath: row.storagePath
      });
    }
  });

  return { extraction, isLoading };
}
