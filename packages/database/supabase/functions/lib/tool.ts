import SupabaseClient from "https://esm.sh/v135/@supabase/supabase-js@2.33.1/dist/module/SupabaseClient.d.ts";
import { StandardSchemaV1 } from "npm:@standard-schema/spec"
import { Database } from "./types.ts";

export interface Tool<
  Args extends undefined | StandardSchemaV1 = undefined | StandardSchemaV1,
> {
  name: string
  description: string
  args?: Args
  run: Args extends StandardSchemaV1
    ? (client: SupabaseClient<Database>, args: StandardSchemaV1.InferOutput<Args>, context: {companyId: string, userId: string}) => Promise<any>
    : () => Promise<any>
}

export function tool<Args extends undefined | StandardSchemaV1>(
  input: Tool<Args>,
) {
  return input
}