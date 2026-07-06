import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { updatePrintJobStatus } from "@carbon/printing";
import { sendToProxyBox } from "@carbon/printing/printing.server";
import { NonRetriableError } from "inngest";
import { inngest } from "../../client";

export const printJobDeliverFunction = inngest.createFunction(
  {
    id: "print-job-deliver",
    retries: 0
  },
  { event: "carbon/print-job-deliver" },
  async ({ event }) => {
    const client = getCarbonServiceRole();
    const { printJobId, companyId } = event.data;

    const { data: job, error: jobError } = await client
      .from("printJob")
      .select("id, content, contentType, printerUrl, status, attempts")
      .eq("id", printJobId)
      .eq("companyId", companyId)
      .single();

    if (jobError || !job) {
      throw new NonRetriableError(`Print job not found: ${printJobId}`);
    }

    if (!job.content || !job.contentType) {
      await updatePrintJobStatus(client, printJobId, companyId, "failed", {
        error: "Print job has no content"
      });
      throw new NonRetriableError("Print job has no content");
    }

    const { data: route } = await client
      .from("printerRoute")
      .select("apiKey")
      .eq("printerUrl", job.printerUrl)
      .eq("companyId", companyId)
      .limit(1)
      .maybeSingle();

    const apiKey = route?.apiKey;

    await client
      .from("printJob")
      .update({
        status: "printing",
        attempts: (job.attempts ?? 0) + 1,
        updatedAt: new Date().toISOString()
      })
      .eq("id", printJobId)
      .eq("companyId", companyId);

    try {
      const content =
        job.contentType === "pdf"
          ? Buffer.from(job.content, "base64")
          : job.content;

      await sendToProxyBox({
        url: job.printerUrl,
        apiKey,
        content
      });

      await updatePrintJobStatus(client, printJobId, companyId, "completed");

      return { success: true };
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Unknown delivery error";

      const isTimeout =
        err instanceof Error &&
        (err.name === "AbortError" ||
          errorMessage.includes("aborted") ||
          errorMessage.includes("timeout"));

      await updatePrintJobStatus(client, printJobId, companyId, "failed", {
        error: errorMessage
      });

      if (isTimeout) {
        // Don't retry on timeout — content was likely already delivered
        // to the print server. Retrying would print duplicate copies.
        throw new NonRetriableError(
          `Delivery timed out — content may have been printed. ${errorMessage}`
        );
      }

      throw err;
    }
  }
);
