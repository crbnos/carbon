import {
  CompiledQuery,
  DatabaseConnection,
  Driver,
  PostgresCursorConstructor,
  QueryResult,
  TransactionSettings,
} from "kysely";
import { Pool, PoolClient } from "pg";

function extendStackTrace(err: unknown, stackError: Error): unknown {
  if (
    err instanceof Error &&
    typeof err.stack === "string" &&
    stackError.stack
  ) {
    const stackExtension = stackError.stack.split("\n").slice(1).join("\n");
    err.stack += `\n${stackExtension}`;
    return err;
  }
  return err;
}

export interface PostgresDialectConfig {
  pool: Pool;
  cursor?: PostgresCursorConstructor;
  onCreateConnection?: (connection: DatabaseConnection) => Promise<void>;
}

const PRIVATE_RELEASE_METHOD = Symbol();

export class PostgresDriver implements Driver {
  readonly #config: PostgresDialectConfig;
  readonly #connections = new WeakMap<PoolClient, DatabaseConnection>();
  #pool?: Pool;

  constructor(config: PostgresDialectConfig) {
    this.#config = Object.freeze({ ...config });
  }

  async init(): Promise<void> {
    this.#pool = this.#config.pool;
  }

  async acquireConnection(): Promise<DatabaseConnection> {
    const client = await this.#pool!.connect();
    let connection = this.#connections.get(client);

    if (!connection) {
      connection = new PostgresConnection(client, {
        cursor: this.#config.cursor ?? null,
      });
      this.#connections.set(client, connection);

      // The driver must take care of calling `onCreateConnection` when a new
      // connection is created. The `pg` module doesn't provide an async hook
      // for the connection creation. We need to call the method explicitly.
      if (this.#config?.onCreateConnection) {
        await this.#config.onCreateConnection(connection);
      }
    }

    return connection;
  }

  async beginTransaction(
    connection: DatabaseConnection,
    settings: TransactionSettings
  ): Promise<void> {
    if (settings.isolationLevel) {
      await connection.executeQuery(
        CompiledQuery.raw(
          `start transaction isolation level ${settings.isolationLevel}`
        )
      );
    } else {
      await connection.executeQuery(CompiledQuery.raw("begin"));
    }
  }

  async commitTransaction(connection: DatabaseConnection): Promise<void> {
    await connection.executeQuery(CompiledQuery.raw("commit"));
  }

  async rollbackTransaction(connection: DatabaseConnection): Promise<void> {
    await connection.executeQuery(CompiledQuery.raw("rollback"));
  }

  async releaseConnection(connection: PostgresConnection): Promise<void> {
    connection[PRIVATE_RELEASE_METHOD]();
  }

  async destroy(): Promise<void> {
    if (this.#pool) {
      const pool = this.#pool;
      this.#pool = undefined;
      await pool.end();
    }
  }
}

interface PostgresConnectionOptions {
  cursor: PostgresCursorConstructor | null;
}

class PostgresConnection implements DatabaseConnection {
  #client: PoolClient;
  #options: PostgresConnectionOptions;

  constructor(client: PoolClient, options: PostgresConnectionOptions) {
    this.#client = client;
    this.#options = options;
  }

  async executeQuery<O>(compiledQuery: CompiledQuery): Promise<QueryResult<O>> {
    try {
      const result = await this.#client.queryObject<O>(compiledQuery.sql, [
        ...compiledQuery.parameters,
      ]);

      if (
        result.command === "INSERT" ||
        result.command === "UPDATE" ||
        result.command === "DELETE"
      ) {
        const numAffectedRows = BigInt(result.rowCount || 0);

        return {
          numUpdatedOrDeletedRows: numAffectedRows,
          numAffectedRows,
          rows: result.rows ?? [],
        } as any;
      }

      return {
        rows: result.rows ?? [],
      };
    } catch (err) {
      throw extendStackTrace(err, new Error());
    }
  }

  // deno-lint-ignore require-yield
  async *streamQuery<O>(
    _compiledQuery: CompiledQuery,
    chunkSize: number
  ): AsyncIterableIterator<QueryResult<O>> {
    if (!this.#options.cursor) {
      throw new Error(
        "'cursor' is not present in your postgres dialect config. It's required to make streaming work in postgres."
      );
    }

    if (!Number.isInteger(chunkSize) || chunkSize <= 0) {
      throw new Error("chunkSize must be a positive integer");
    }

    // stream not available
    return null;
  }

  [PRIVATE_RELEASE_METHOD](): void {
    this.#client.release();
  }
}
