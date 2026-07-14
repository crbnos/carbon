import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { EXTRACTION_CONFIDENCE_THRESHOLD } from "@carbon/env";
import { inngest } from "../../client";
import { invoiceExtractionSchema, rfqExtractionSchema } from "./schemas";

function parseDateToISO8601(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  const cleaned = value.trim();

  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) {
    return cleaned;
  }

  // YYYY-MM-DDTHH:mm:...
  if (/^\d{4}-\d{2}-\d{2}T/.test(cleaned)) {
    return cleaned.slice(0, 10);
  }

  const parsed = Date.parse(cleaned);
  if (isNaN(parsed)) return null;

  const d = new Date(parsed);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export const extractDocumentFunction = inngest.createFunction(
  { id: "extract-document", retries: 2 },
  { event: "carbon/extract-document" },
  async ({ event, step, logger }) => {
    const { documentExtractionId, companyId } = event.data;

    await step.run("extract-and-save", async () => {
      const client = getCarbonServiceRole();

      // 1. Fetch the extraction record
      const { data: extraction, error: fetchErr } = await client
        .from("documentExtraction")
        .select("*")
        .eq("id", documentExtractionId)
        .eq("companyId", companyId)
        .single();

      if (fetchErr || !extraction) {
        logger.error("Failed to fetch extraction record", { fetchErr });
        throw new Error("Extraction record not found");
      }

      // 2. Update status to processing
      await client
        .from("documentExtraction")
        .update({
          status: "processing" as const,
          updatedAt: new Date().toISOString()
        })
        .eq("id", documentExtractionId)
        .eq("companyId", companyId);

      try {
        // 3. Download PDF from Supabase Storage
        const { data: fileData, error: downloadErr } = await client.storage
          .from("private")
          .download(extraction.storagePath);

        if (downloadErr || !fileData) {
          throw new Error(`Failed to download PDF: ${downloadErr?.message}`);
        }

        // 4. Extract text from PDF using pdfjs-dist
        const buffer = await fileData.arrayBuffer();
        const uint8Array = new Uint8Array(buffer);
        // @ts-ignore pdfjs-dist legacy build lacks type declarations
        const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
        const pdf = await pdfjs.getDocument({ data: uint8Array }).promise;
        let pdfText = "";
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const textContent = await page.getTextContent();
          const pageText = textContent.items
            .map((item: any) => item.str)
            .join(" ");
          pdfText += `--- Page ${i} ---\n${pageText}\n\n`;
        }
        await pdf.destroy();

        // 5. Load candidate options so the AI can resolve extracted names to
        // real record ids itself (instead of the app fuzzy-matching afterward).
        // All lists are company-scoped; cap and log rather than silently truncate.
        const CANDIDATE_LIMIT = 1000;
        type Candidate = { id: string; name: string };
        const supplierCandidates: Candidate[] = [];
        const paymentTermCandidates: Candidate[] = [];
        const customerCandidates: Candidate[] = [];

        const collect = (
          rows: Candidate[] | null,
          into: Candidate[],
          label: string
        ) => {
          into.push(...(rows ?? []).slice(0, CANDIDATE_LIMIT));
          if ((rows?.length ?? 0) > CANDIDATE_LIMIT) {
            logger.warn(
              `${label} candidate list truncated to ${CANDIDATE_LIMIT} for company ${companyId}`
            );
          }
        };

        if (extraction.documentType === "purchaseInvoice") {
          const [{ data: suppliers }, { data: paymentTerms }] =
            await Promise.all([
              client
                .from("supplier")
                .select("id, name")
                .eq("companyId", companyId)
                .order("name")
                .limit(CANDIDATE_LIMIT + 1),
              client
                .from("paymentTerm")
                .select("id, name")
                .eq("companyId", companyId)
                .order("name")
                .limit(CANDIDATE_LIMIT + 1)
            ]);
          collect(suppliers, supplierCandidates, "Supplier");
          collect(paymentTerms, paymentTermCandidates, "Payment term");
        } else {
          const { data: customers } = await client
            .from("customer")
            .select("id, name")
            .eq("companyId", companyId)
            .order("name")
            .limit(CANDIDATE_LIMIT + 1);
          collect(customers, customerCandidates, "Customer");
        }

        const candidatesSection =
          extraction.documentType === "purchaseInvoice"
            ? `Known suppliers (choose the matching id for supplierId, or null):\n${JSON.stringify(supplierCandidates)}\n\nKnown payment terms (choose the matching id for paymentTermId, or null):\n${JSON.stringify(paymentTermCandidates)}`
            : `Known customers (choose the matching id for customerId, or null):\n${JSON.stringify(customerCandidates)}`;

        const matchingInstruction =
          " For the id fields, you are given lists of known records; return the id of the single best match, or null if none of the listed records clearly correspond to the document. Do NOT invent ids — only return an id that appears in the provided lists.";

        const systemPrompt =
          extraction.documentType === "purchaseInvoice"
            ? "You are an ERP data extraction assistant. Extract invoice data from this PDF. For each field, provide the extracted value and a confidence score between 0.0 and 1.0. If a field is not found or you are unsure, set value to null and confidence to 0.0." +
              matchingInstruction
            : "You are an ERP data extraction assistant. Extract RFQ (Request for Quote) data from this PDF. For each field, provide the extracted value and a confidence score between 0.0 and 1.0. If a field is not found or you are unsure, set value to null and confidence to 0.0." +
              matchingInstruction;

        // 6. Call AI with structured output validated against the zod schema
        const { generateObject } = await import("ai");
        const { createOpenAI } = await import("@ai-sdk/openai");

        const aiApiKey =
          process.env.AI_API_KEY || process.env.OPENAI_API_KEY || "mock-key";
        const aiBaseUrl = process.env.AI_BASE_URL;
        const aiModelName = process.env.AI_MODEL || "gpt-4o";

        const provider = createOpenAI({
          apiKey: aiApiKey,
          baseURL: aiBaseUrl,
          fetch: async (url, init) => {
            return fetch(url, {
              ...init,
              signal: AbortSignal.timeout(60_000)
            });
          }
        });

        const model = provider.chat(aiModelName);

        const prompt = `${systemPrompt}\n\nCandidate records to match against:\n${candidatesSection}\n\nHere is the text extracted from the PDF document:\n\n${pdfText}`;

        const { object: validated } =
          extraction.documentType === "purchaseInvoice"
            ? await generateObject({
                model,
                maxRetries: 5,
                schema: invoiceExtractionSchema,
                prompt
              })
            : await generateObject({
                model,
                maxRetries: 5,
                schema: rfqExtractionSchema,
                prompt
              });

        // 7. Filter by confidence threshold
        const threshold = EXTRACTION_CONFIDENCE_THRESHOLD;
        const raw = validated as Record<string, unknown>;
        const filtered: Record<string, unknown> = {};
        const dateFields = [
          "invoiceDate",
          "dueDate",
          "rfqDate",
          "requestedDeliveryDate"
        ];

        for (const [key, val] of Object.entries(raw)) {
          if (key === "lineItems" && Array.isArray(val)) {
            filtered.lineItems = val.map((line: Record<string, unknown>) => {
              const filteredLine: Record<string, unknown> = {};
              for (const [lk, lv] of Object.entries(line)) {
                if (
                  lv &&
                  typeof lv === "object" &&
                  lv !== null &&
                  "confidence" in lv
                ) {
                  const field = lv as { value: unknown; confidence: number };
                  filteredLine[lk] =
                    field.confidence >= threshold ? field.value : null;
                }
              }
              return filteredLine;
            });
          } else if (
            val &&
            typeof val === "object" &&
            val !== null &&
            "confidence" in val
          ) {
            const field = val as { value: unknown; confidence: number };
            let extractedValue =
              field.confidence >= threshold ? field.value : null;
            if (extractedValue !== null && dateFields.includes(key)) {
              extractedValue =
                parseDateToISO8601(extractedValue) ?? extractedValue;
            }
            filtered[key] = extractedValue;
          }
        }

        // 8. Save results
        await client
          .from("documentExtraction")
          .update({
            status: "completed" as const,
            extractedData: raw as any,
            filteredData: filtered as any,
            updatedAt: new Date().toISOString()
          })
          .eq("id", documentExtractionId)
          .eq("companyId", companyId);
      } catch (err) {
        logger.error("Extraction failed", { err });
        await client
          .from("documentExtraction")
          .update({
            status: "failed" as const,
            error: err instanceof Error ? err.message : String(err),
            updatedAt: new Date().toISOString()
          })
          .eq("id", documentExtractionId)
          .eq("companyId", companyId);
        throw err;
      }
    });
  }
);
