import { redis } from "@carbon/kv";

// Public health check: no auth. Redis is resilience-wrapped, so ping() resolves
// null instead of throwing when Redis is unreachable.
export async function loader() {
  const ping = await redis.ping();
  const up = !!ping;
  return Response.json(
    { status: up ? "healthy" : "degraded", redis: up ? "up" : "down" },
    { status: 200 }
  );
}
