/**
 * Database client singleton for server-side usage.
 * Similar to Prisma client singleton. from https://www.prisma.io/docs/guides/react-router-7
 * Polluting the global namespace like this is usually discouraged, but it's okay as we're just caching connections during development.
 * In production, this code path is not hit multiple times as ESM modules are only singletons by default.
 */
import {
  getPostgresClient,
  getPostgresConnectionPool
} from "@carbon/database/client";
import { PostgresDriver } from "kysely";

const init = () => {
  const pool = getPostgresConnectionPool(10);
  // We use the PostgresDriver from Kysely here as this code only runs in Node environment
  return getPostgresClient(pool, PostgresDriver);
};

type ClientSingleton = ReturnType<typeof init>;

const globalForKysely = globalThis as unknown as {
  kysely: ClientSingleton | undefined;
};

const database = globalForKysely.kysely ?? init();

if (process.env.NODE_ENV !== "production") globalForKysely.kysely = database;

export const getDatabaseClient = () => database;
