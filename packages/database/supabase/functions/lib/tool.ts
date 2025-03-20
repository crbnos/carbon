import SupabaseClient from "https://esm.sh/v135/@supabase/supabase-js@2.33.1/dist/module/SupabaseClient.d.ts";
import { StandardSchemaV1 } from "npm:@standard-schema/spec";
import {
  Kysely,
  Transaction,
} from "https://esm.sh/v135/kysely@0.26.3/dist/cjs/kysely.d.ts";
import { Database } from "./types.ts";
import { DB } from "./database.ts";

export interface Tool<
  Args extends undefined | StandardSchemaV1 = undefined | StandardSchemaV1
> {
  name: string;
  description: string;
  args?: Args;
  run: Args extends StandardSchemaV1
    ? (
        args: StandardSchemaV1.InferOutput<Args>,
        context: {
          companyId: string;
          userId: string;
          client: SupabaseClient<Database>;
          db: Kysely<DB> | Transaction<DB>;
        }
      ) => Promise<unknown>
    : () => Promise<unknown>;
}

export function tool<Args extends undefined | StandardSchemaV1>(
  input: Tool<Args>
) {
  return input;
}
