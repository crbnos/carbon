import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { redis } from "@carbon/kv";

// Public health check: no auth, and it ALWAYS returns HTTP 200. This endpoint
// backs the load balancer's target-group health check, so a transient dependency
// blip must not mark every task unhealthy and cycle the whole service. The body
// reports per-dependency status for monitoring (NIST 800-171 3.14.6) instead.
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

  const healthy = redisUp && databaseUp;

  return Response.json(
    { status: healthy ? "healthy" : "degraded", checks },
    { status: 200 }
  );
}
