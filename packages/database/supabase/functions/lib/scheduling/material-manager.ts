import { Kysely } from "https://esm.sh/kysely@0.26.3";

import { DB } from "../database.ts";

class MaterialManager {
  private db: Kysely<DB>;
  private companyId: string;

  constructor(db: Kysely<DB>, companyId: string) {
    this.db = db;
    this.companyId = companyId;
  }

  async initialize(jobId: string) {
    if (!this.db) {
      throw new Error("Database connection is not initialized");
    }

    const [materialToAssign, jobOperations] = await Promise.all([
      this.db
        .selectFrom("jobMaterial")
        .selectAll()
        .where("jobId", "=", jobId)
        .where("jobOperationId", "is", null)
        .where("companyId", "=", this.companyId)
        .execute(),
      this.db
        .selectFrom("jobOperation")
        .selectAll()
        .where("jobId", "=", jobId)
        .execute(),
    ]);

    console.log({ materialToAssign, jobOperations });
  }
}

export { MaterialManager };
