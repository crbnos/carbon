import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { serve } from "https://deno.land/std@0.175.0/http/server.ts";
import z from "npm:zod@^3.24.1";
import { sql } from "https://esm.sh/kysely@0.26.3";
import { DB, getConnectionPool, getDatabaseClient } from "../lib/database.ts";
import { Kysely } from "https://esm.sh/v135/kysely@0.26.3/dist/cjs/kysely.d.ts";

const pool = getConnectionPool(1);
const db = getDatabaseClient<DB>(pool);
const model = new Supabase.ai.Session('gte-small');

const jobSchema = z.object({
  jobId: z.number(),
  id: z.number(),
  schema: z.string(),
  table: z.string(),
  contentFunction: z.string(),
  embeddingColumn: z.string(),
});


const failedJobSchema = jobSchema.extend({
  error: z.string(),
})

type Job = z.infer<typeof jobSchema>
type FailedJob = z.infer<typeof failedJobSchema>

type Row = {
  id: string
  content: unknown
}

const QUEUE_NAME = 'embedding_jobs'



serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response('expected POST request', { status: 405 })
  }

  if (req.headers.get('content-type') !== 'application/json') {
    return new Response('expected json body', { status: 400 })
  }

  // Use Zod to parse and validate the request body
  const parseResult = z.array(jobSchema).safeParse(await req.json())

  if (parseResult.error) {
    return new Response(`invalid request body: ${parseResult.error.message}`, {
      status: 400,
    })
  }

  const pendingJobs = parseResult.data

  // Track jobs that completed successfully
  const completedJobs: Job[] = []

  // Track jobs that failed due to an error
  const failedJobs: FailedJob[] = []

  async function processJobs() {
    let currentJob: Job | undefined

    while ((currentJob = pendingJobs.shift()) !== undefined) {
      try {
        await processJob(db, currentJob)
        completedJobs.push(currentJob)
      } catch (error) {
        failedJobs.push({
          ...currentJob,
          error: error instanceof Error ? error.message : JSON.stringify(error),
        })
      }
    }
  }

  try {
    // Process jobs while listening for worker termination
    await Promise.race([processJobs(), catchUnload()])
  } catch (error) {
    // If the worker is terminating (e.g. wall clock limit reached),
    // add pending jobs to fail list with termination reason
    failedJobs.push(
      ...pendingJobs.map((job) => ({
        ...job,
        error: error instanceof Error ? error.message : JSON.stringify(error),
      }))
    )
  }

  // Log completed and failed jobs for traceability
  console.log('finished processing jobs:', {
    completedJobs: completedJobs.length,
    failedJobs: failedJobs.length,
  })

  return new Response(
    JSON.stringify({
      completedJobs,
      failedJobs,
    }),
    {
      // 200 OK response
      status: 200,

      // Custom headers to report job status
      headers: {
        'content-type': 'application/json',
        'x-completed-jobs': completedJobs.length.toString(),
        'x-failed-jobs': failedJobs.length.toString(),
      },
    }
  )
});


/**
 * Generates an embedding for the given text.
 */
async function generateEmbedding(text: string): Promise<number[]> {
  const embedding = await model.run(text, {
    mean_pool: true,
    normalize: true
  });

  return embedding as number[];
}

/**
 * Processes an embedding job.
 */
async function processJob(db: Kysely<DB>, job: Job) {
  const { jobId, id, schema, table, contentFunction, embeddingColumn } = job

  // Fetch content for the schema/table/row combination
  const result = await sql<{id: string, content: string}>`
    select
      id,
      ${contentFunction}(t) as content
    from
      ${schema}.${table} t
    where
      id = ${id}
  `.execute(db)
  
  const [row] = result.rows

  if (!row) {
    throw new Error(`row not found: ${schema}.${table}/${id}`)
  }

  if (typeof row.content !== 'string') {
    throw new Error(`invalid content - expected string: ${schema}.${table}/${id}`)
  }

  const embedding = await generateEmbedding(row.content)

  await sql`
    update
      ${schema}.${table}
    set
      ${embeddingColumn} = ${JSON.stringify(embedding)}
    where
      id = ${id}
  `.execute(db)

  await sql`
    select pgmq.delete(${QUEUE_NAME}, ${jobId}::bigint)
  `.execute(db)
}

/**
 * Returns a promise that rejects if the worker is terminating.
 */
function catchUnload() {
  return new Promise((reject) => {
    addEventListener('beforeunload', (ev: any) => {
      reject(new Error(ev.detail?.reason))
    })
  })
}