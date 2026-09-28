import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { redis } from "@carbon/kv";

// Public health check: no auth. The status CODE answers the one question a
// probe or load balancer can act on — can this pod serve — so it turns on
// the database alone: 503 without it, because nothing works without it.
// Redis is reported in the body but does not gate the code: a cache blip
// degrades the app, and pulling every pod out of the Service over it would
// turn a degradation into the very outage it reported. The body carries the
// full per-dependency truth for monitoring (NIST 800-171 3.14.6).
//
// Kubernetes reads only the code (any 2xx passes), which is why the old
// always-200 contract made every probe a hollow gate: a rollout would cut
// over to a pod the moment its HTTP server bound, whether or not it could
// serve a single request. The chart's liveness probe does NOT hit this
// endpoint (it is a TCP check), so a dead database makes pods unready —
// never killed.
const CHECK_TIMEOUT_MS = 2_000;

// Resolve a dependency probe to a boolean, treating a throw or a slow response as
// "down" so one hung dependency can't hang the endpoint.
function probe(check: () => Promise<boolean>): Promise<boolean> {
  return Promise.race([
    check().catch(() => false),
    new Promise<boolean>((resolve) =>
      setTimeout(() => resolve(false), CHECK_TIMEOUT_MS)
    )
  ]);
}

export async function loader() {
  const client = getCarbonServiceRole();

  const [redisUp, databaseUp] = await Promise.all([
    // redis is resilience-wrapped: ping() resolves null instead of throwing when
    // Redis is unreachable.
    probe(async () => !!(await redis.ping())),
    // Cheapest possible round-trip to Postgres via PostgREST: HEAD with an
    // estimated count, no rows returned.
    probe(async () => {
      const { error } = await client
        .from("company")
        .select("id", { head: true, count: "estimated" });
      return !error;
    })
  ]);

  const checks = {
    redis: redisUp ? "up" : "down",
    database: databaseUp ? "up" : "down"
  };

  return Response.json(
    { status: redisUp && databaseUp ? "healthy" : "degraded", checks },
    { status: databaseUp ? 200 : 503 }
  );
}
