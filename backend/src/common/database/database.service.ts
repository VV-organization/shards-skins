import { Inject, Injectable, OnModuleDestroy, ServiceUnavailableException } from "@nestjs/common";
import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from "pg";

import type { DatabaseConnectionOptions } from "./database.config";
import { DATABASE_CONNECTION_OPTIONS } from "./database.tokens";

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly pool: Pool | null;

  constructor(@Inject(DATABASE_CONNECTION_OPTIONS) options: DatabaseConnectionOptions) {
    this.pool = options.enabled ? new Pool({ connectionString: options.databaseUrl }) : null;
  }

  isConfigured(): boolean {
    return this.pool !== null;
  }

  async query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<QueryResult<Row>> {
    if (this.pool === null) {
      throw new ServiceUnavailableException("Database is not configured");
    }
    return this.pool.query<Row>(text, [...values]);
  }

  async transaction<T>(
    work: (client: { query: <Row extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]) => Promise<QueryResult<Row>> }) => Promise<T>,
  ): Promise<T> {
    if (this.pool === null) {
      throw new ServiceUnavailableException("Database is not configured");
    }
    const client: PoolClient = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await work({
        query: <Row extends QueryResultRow = QueryResultRow>(text: string, values: readonly unknown[] = []) => client.query<Row>(text, [...values]),
      });
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool?.end();
  }
}
