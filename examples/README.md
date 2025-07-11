# Examples

This folder contains examples for interacting with Carbon through the API to accomplish different things.

In most cases, we first define an API client like this, and then selectively add methods. Each example will have different methods to accomplish some task. For more details, we recommend checking out the `.service.ts` files in the `/apps` repo.

```ts
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@supabase/supabase-js";
import {
  CARBON_API_KEY,
  CARBON_API_URL,
  CARBON_APP_URL,
  CARBON_COMPANY_ID,
  CARBON_PUBLIC_KEY,
} from "~/config";

class CarbonClient {
  private readonly appUrl: string = CARBON_APP_URL;
  private readonly client: SupabaseClient;
  private readonly companyId: string = CARBON_COMPANY_ID;
  constructor() {
    this.client = createClient(CARBON_API_URL, CARBON_PUBLIC_KEY, {
      global: {
        headers: {
          "carbon-key": CARBON_API_KEY,
        },
      },
    });
  }
}

const carbon = new CarbonClient();
export { carbon };
```
