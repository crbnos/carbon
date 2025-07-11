# Edge Function Workflow

This workflow describes the process for creating and extending Supabase Edge Functions in the Carbon manufacturing system.

## Prerequisites

- Ensure you have the latest code from the main branch
- Verify Supabase CLI is installed and configured
- Check that your local Supabase instance is running
- Understand the dual authentication pattern (API key + Bearer token)

## Steps

### 1. Generate Edge Function

Run the function creation command:

```bash
npm run db:function:new <description>
```

This will create a new function directory at `packages/database/supabase/functions/<description>/index.ts`.

### 2. Analyze the Function Requirements

- Identify the function's purpose and expected inputs/outputs
- Determine if it needs database access (Kysely vs Supabase client)
- Consider authentication requirements
- Plan for multi-tenancy (companyId handling)
- Identify any shared utilities or business logic needed

### 3. Implement the Edge Function

#### Standard Function Structure

```typescript
import { serve } from "https://deno.land/std@0.175.0/http/server.ts";
import { z } from "npm:zod@^3.24.1";
import { corsHeaders } from "../lib/headers.ts";
import { getSupabaseServiceRole } from "../lib/supabase.ts";
import { Database } from "../lib/types.ts";

// Input validation schema
const payloadValidator = z.object({
  companyId: z.string(),
  userId: z.string(),
  // Add your specific fields here
});

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Parse and validate input
    const payload = await req.json();
    const { companyId, userId, ...data } = payloadValidator.parse(payload);

    const authHeader = req.headers.get("Authorization");
    const token = authHeader?.replace("Bearer ", "") ?? null;
    if (token && !client) {
      client = getSupabase(token);
      authenticatedCompanyId = req.headers.get("x-company-id");
      await client.auth.setSession({
        access_token: token,
        refresh_token: token,
      });
    }

    // Authorization check
    if (!client || !authenticatedCompanyId || !authenticatedUserId) {
      return new Response("Unauthorized", {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 401,
      });
    }

    // Main function logic here
    const result = await performMainOperation(data, {
      client,
      companyId: authenticatedCompanyId,
      userId: authenticatedUserId,
    });

    return new Response(JSON.stringify({ success: true, ...result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (err) {
    console.error(`Error in ${req.url}:`, err);

    // Optional: Cleanup operations on error
    // Example: Revert status changes, rollback transactions, etc.

    return new Response(JSON.stringify({ error: err.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});

async function performMainOperation(
  data: any,
  context: { client: any; companyId: string; userId: string }
) {
  // Implement your main logic here
  // Use context.companyId for multi-tenancy
  // Use context.client for database operations
  // Use context.userId for audit trails
}
```

#### For Database-Heavy Operations (Using Kysely)

```typescript
import { getConnectionPool, getDatabaseClient } from "../lib/database.ts";
import type { DB } from "../lib/types.ts";

// Inside your function
const pool = getConnectionPool(1);
const db = getDatabaseClient<DB>(pool);

// Use transactions for data consistency
await db.transaction().execute(async (trx) => {
  const result = await trx
    .insertInto("tableName")
    .values({
      id: nanoid(),
      companyId,
      createdBy: userId,
      ...data,
    })
    .returning("id")
    .executeTakeFirstOrThrow();

  // Additional operations...
});
```

#### Input Validation Patterns

```typescript
// Simple validation
const payloadValidator = z.object({
  companyId: z.string(),
  userId: z.string(),
  name: z.string().min(1),
  amount: z.number().positive(),
});

// Discriminated union for multiple operation types
const payloadValidator = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("create"),
    companyId: z.string(),
    userId: z.string(),
    data: z.object({
      name: z.string(),
      // ... other fields
    }),
  }),
  z.object({
    type: z.literal("update"),
    companyId: z.string(),
    userId: z.string(),
    id: z.string(),
    data: z.object({
      name: z.string().optional(),
      // ... other fields
    }),
  }),
]);
```

### 4. Add Shared Utilities (If Needed)

If your function needs shared business logic, add it to appropriate directories:

- **Database utilities**: `packages/database/supabase/functions/lib/`
- **Business logic**: `packages/database/supabase/functions/shared/`

Example shared utility:

```typescript
// packages/database/supabase/functions/shared/accounting.ts
export async function createJournalEntry(
  trx: any,
  data: {
    companyId: string;
    userId: string;
    reference: string;
    entries: Array<{ account: string; debit?: number; credit?: number }>;
  }
) {
  // Shared accounting logic
}
```

### 5. Test the Edge Function

#### Local Testing

```bash
# Start Supabase local development
npm run db:start

# Test your function
curl -X POST 'http://localhost:54321/functions/v1/<function-name>' \
  -H 'Authorization: Bearer <token>' \
  -H 'Content-Type: application/json' \
  -H 'x-company-id: <company-id>' \
  -d '{
    "companyId": "<company-id>",
    "userId": "<user-id>",
    "data": {}
  }'
```

#### Integration Testing

- Test with both API key and Bearer token authentication
- Verify multi-tenancy isolation
- Test error scenarios (invalid input, unauthorized access)
- Check CORS headers work properly

### 6. Deploy and Monitor

#### Deployment

```bash
# Deploy to staging/production
npm run db:deploy
```

#### Monitoring

- Check function logs in Supabase dashboard
- Monitor performance metrics
- Set up alerts for error rates

## Carbon-Specific Patterns

### Multi-Tenancy Requirements

- Always filter operations by `companyId`
- Include `companyId` in all database inserts
- Use `companyId` from authenticated context, not payload

### Audit Trail Pattern

```typescript
const auditData = {
  createdBy: userId,
  createdAt: new Date().toISOString(),
  updatedBy: userId,
  updatedAt: new Date().toISOString(),
};
```

### Sequence Generation

```typescript
import { getNextSequence } from "../shared/sequences.ts";

const sequenceNumber = await getNextSequence(trx, "sequenceName", companyId);
```

### Error Cleanup Pattern

```typescript
catch (err) {
  console.error(`Error in functionName:`, err);

  // Cleanup operations
  if (createdRecordId) {
    await client
      .from("tableName")
      .update({ status: "Draft" })
      .eq("id", createdRecordId);
  }

  return new Response(JSON.stringify({ error: err.message }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status: 500,
  });
}
```

## Best Practices

- **Always handle CORS** with OPTIONS method
- **Use Zod validation** for all inputs
- **Implement dual authentication** (API key + Bearer token)
- **Include companyId filtering** for multi-tenancy
- **Use database transactions** for data consistency
- **Add comprehensive error handling** with cleanup logic
- **Follow consistent response format** with proper HTTP status codes
- **Include audit fields** (createdBy, updatedBy, timestamps)
- **Use TypeScript types** from the generated database schema
- **Add logging** with function name and key parameters
- **Handle environment variables** safely
- **Use shared utilities** to avoid code duplication

## Common Pitfalls to Avoid

- Forgetting to handle OPTIONS requests for CORS
- Not validating inputs with Zod schemas
- Missing companyId in database operations
- Not implementing proper error cleanup
- Using payload companyId instead of authenticated companyId
- Forgetting to use transactions for multi-table operations
- Not handling both authentication methods
- Missing proper TypeScript types
- Not including audit trail fields

## Function Checklist

- [ ] Function created with `npm run db:function:new <name>`
- [ ] CORS handling implemented (OPTIONS method)
- [ ] Input validation with Zod schema
- [ ] Dual authentication pattern implemented
- [ ] Multi-tenancy with companyId filtering
- [ ] Database operations use transactions where needed
- [ ] Error handling with cleanup logic
- [ ] Proper response format with HTTP status codes
- [ ] Audit fields included in database operations
- [ ] TypeScript types from database schema
- [ ] Function tested locally and with both auth methods
- [ ] Deployment tested in staging environment
