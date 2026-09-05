import { serve } from "https://deno.land/std@0.175.0/http/server.ts";
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { Kysely, sql } from "kysely";
import z from "npm:zod@^4.5.4";
import { generateEmbedding } from "../lib/ai/embedding.ts";
import { DB, getConnectionPool, getDatabaseClient } from "../lib/database.ts";
import { getFunctionLogger } from "../lib/logging.ts";

const pool = getConnectionPool(1);
const db = getDatabaseClient<DB>(pool);
const logger = getFunctionLogger("embed");

const jobSchema = z.object({
  jobId: z.number(),
  id: z.string(),
  table: z.string(),
});

const failedJobSchema = jobSchema.extend({
  error: z.string(),
});

type Job = z.infer<typeof jobSchema>;
type FailedJob = z.infer<typeof failedJobSchema>;

type Row = {
  id: string;
  content: unknown;
};

const QUEUE_NAME = "embedding_jobs";

serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("expected POST request", { status: 405 });
  }

  if (req.headers.get("content-type") !== "application/json") {
    return new Response("expected json body", { status: 400 });
  }

  // Use Zod to parse and validate the request body
  const parseResult = z.array(jobSchema).safeParse(await req.json());

  logger.info(parseResult);

  if (parseResult.error) {
    return new Response(`invalid request body: ${parseResult.error.message}`, {
      status: 400,
    });
  }

  const pendingJobs = parseResult.data;

  // Track jobs that completed successfully
  const completedJobs: Job[] = [];

  // Track jobs that failed due to an error
  const failedJobs: FailedJob[] = [];

  async function processJobs() {
    let currentJob: Job | undefined;

    while ((currentJob = pendingJobs.shift()) !== undefined) {
      try {
        await processJob(db, currentJob);
        completedJobs.push(currentJob);
      } catch (error) {
        logger.error("processJob failed", {
          error:
            error instanceof Error
              ? (error.stack ?? error.message)
              : JSON.stringify(error),
        });
        failedJobs.push({
          ...currentJob,
          error: error instanceof Error ? error.message : JSON.stringify(error),
        });
      }
    }
  }

  try {
    // Process jobs while listening for worker termination
    await Promise.race([processJobs(), catchUnload()]);
  } catch (error) {
    // If the worker is terminating (e.g. wall clock limit reached),
    // add pending jobs to fail list with termination reason
    logger.error("embed worker terminating", {
      error:
        error instanceof Error
          ? (error.stack ?? error.message)
          : JSON.stringify(error),
    });
    failedJobs.push(
      ...pendingJobs.map((job) => ({
        ...job,
        error: error instanceof Error ? error.message : JSON.stringify(error),
      }))
    );
  }

  // Log completed and failed jobs for traceability
  logger.info("finished processing jobs", {
    completedJobs: completedJobs.length,
    failedJobs: failedJobs.length,
  });

  const responseBody = JSON.stringify({
    completedJobs,
    failedJobs,
  });

  return new Response(responseBody, {
    // 200 OK response
    status: 200,

    // Custom headers to report job status
    headers: {
      "content-type": "application/json",
      "content-length": new TextEncoder()
        .encode(responseBody)
        .length.toString(),
      "x-completed-jobs": completedJobs.length.toString(),
      "x-failed-jobs": failedJobs.length.toString(),
    },
  });
});

/**
 * Processes an embedding job.
 */
async function processJob(db: Kysely<DB>, job: Job) {
  const { jobId, id, table } = job;

  logger.debug(`Processing job ${jobId} for ${table} with id ${id}`);

  if (table === "item") {
    logger.debug("Fetching item from database...");
    const item = await db
      .selectFrom("item")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();

    logger.debug("Item fetched", {
      id: item?.id,
      name: item?.name,
      description: item?.description,
    });

    const textParts = [item?.name, item?.description].filter(
      (part): part is string => typeof part === "string" && part.length > 0
    );

    const textToEmbed = textParts.join(" ");
    logger.debug("Text to embed", { textToEmbed });

    const embedding = await generateEmbedding(textToEmbed);
    const embeddingString = JSON.stringify(embedding);

    logger.debug("Updating item with embedding...", {
      embeddingLength: embedding.length,
      embeddingStringLength: embeddingString.length,
    });

    const result = await db
      .updateTable("item")
      .set({
        embedding: embeddingString,
      })
      .where("id", "=", id)
      .execute();

    logger.debug("Item update result", { result });
  }

  if (table === "supplier") {
    logger.debug("Fetching supplier from database...");
    const supplier = await db
      .selectFrom("supplier")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();

    logger.debug("Supplier fetched", {
      id: supplier?.id,
      name: supplier?.name,
    });

    const textToEmbed = supplier?.name || "";

    if (!textToEmbed) {
      throw new Error(`Supplier ${id} has no name to embed`);
    }

    logger.debug("Text to embed", { textToEmbed });

    const embedding = await generateEmbedding(textToEmbed);
    const embeddingString = JSON.stringify(embedding);

    logger.debug("Updating supplier with embedding...", {
      embeddingLength: embedding.length,
      embeddingStringLength: embeddingString.length,
    });

    // TODO: if there is a website, use firecrawl to get some more information
    const result = await db
      .updateTable("supplier")
      .set({
        embedding: embeddingString,
      })
      .where("id", "=", id)
      .execute();

    logger.debug("Supplier update result", { result });
  }

  if (table === "customer") {
    logger.debug("Fetching customer from database...");
    const customer = await db
      .selectFrom("customer")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();

    logger.debug("Customer fetched", {
      id: customer?.id,
      name: customer?.name,
    });

    const textToEmbed = customer?.name || "";

    if (!textToEmbed) {
      throw new Error(`Customer ${id} has no name to embed`);
    }

    logger.debug("Text to embed", { textToEmbed });

    const embedding = await generateEmbedding(textToEmbed);
    const embeddingString = JSON.stringify(embedding);

    logger.debug("Updating customer with embedding...", {
      embeddingLength: embedding.length,
      embeddingStringLength: embeddingString.length,
    });

    // TODO: if there is a website, use firecrawl to get some more information
    const result = await db
      .updateTable("customer")
      .set({
        embedding: embeddingString,
      })
      .where("id", "=", id)
      .execute();

    logger.debug("Customer update result", { result });
  }

  logger.debug(`Deleting job ${jobId} from queue...`);
  const deleteResult =
    await sql`select pgmq.delete(${QUEUE_NAME}, ${jobId}::bigint)`.execute(db);
  logger.debug("Queue delete result", { deleteResult });

  logger.debug(`Job ${jobId} processing completed successfully`);
}

/**
 * Returns a promise that rejects if the worker is terminating.
 */
function catchUnload() {
  return new Promise((reject) => {
    // deno-lint-ignore no-explicit-any
    addEventListener("beforeunload", (ev: any) => {
      reject(new Error(ev.detail?.reason));
    });
  });
}
