import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.33.1";
import type { Database } from "../types.ts";
import { ResourceManager } from "./resource-manager.ts";

class SchedulingEngine {
  resourceManager: ResourceManager;

  constructor(client: SupabaseClient<Database>, companyId: string) {
    this.resourceManager = new ResourceManager(client, companyId);
  }
}

export { SchedulingEngine };
