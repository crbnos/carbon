# API Key Rate Limiting and Read/Write Scopes

## Context

Currently, API keys in Carbon grant **full access** to all company data without any permission restrictions or rate limiting. This creates security and resource management concerns:

1. **No granular permissions**: Any valid API key can read, create, update, or delete all data within a company
2. **No rate limiting**: API keys can make unlimited requests, risking resource exhaustion
3. **No scope control**: Cannot create read-only or module-specific API keys

The goal is to add scoped permissions and rate limiting to API keys while maintaining backward compatibility with existing integrations.

## Architecture Considerations

### Why Dual-Layer Rate Limiting?

Carbon has three entry points for API key requests:

1. **PostgREST (Direct DB)**: Most common - clients call `/rest/v1/*` endpoints directly. These bypass all application code and go straight to PostgreSQL via PostgREST. RLS policies are the only enforcement layer.

2. **Remix Routes**: Some operations go through `requirePermissions()` in the application layer before hitting the database.

3. **Supabase Edge Functions**: Deno functions like `post-sales-invoice`, `import-csv` that handle complex operations.

Rate limiting must be implemented at **all three layers** to be effective:
- **Database**: Catches PostgREST requests (the majority)
- **Application**: Provides better error responses with 429 status + headers
- **Edge Functions**: Handles Deno function calls

### Database Rate Limiting Challenges

1. **Multiple RLS calls per request**: A single API request may access multiple tables, triggering RLS checks multiple times. We use `request.id` to avoid double-counting.

2. **Performance**: Rate limit checks add overhead to every query. Using a simple fixed-window approach (vs sliding window) is more performant for PostgreSQL.

3. **Cleanup**: The rate limit table needs periodic cleanup of old entries (pg_cron or application-level job).

## Current Architecture

### API Key Authentication Flow

1. Request arrives with `carbon-key` header
2. `requirePermissions()` in `packages/auth/src/services/auth.server.ts:112-127` **bypasses all permission checks** for API keys
3. RLS helper functions (`get_companies_with_employee_permission`, etc.) in `packages/database/supabase/migrations/20250201181148_rls-refactor.sql` return **full company access** for API keys

### Key Files

| File | Current Behavior |
|------|------------------|
| `packages/auth/src/services/auth.server.ts:63-70` | `getCompanyIdFromAPIKey()` - only retrieves companyId and createdBy |
| `packages/auth/src/services/auth.server.ts:112-127` | `requirePermissions()` - returns immediately for API keys, no permission check |
| `packages/database/supabase/migrations/20250201181148_rls-refactor.sql:48-61` | `get_companies_with_employee_permission()` - returns full access for API keys |
| `packages/database/supabase/migrations/20240728004118_api-keys.sql` | API key table schema - no scope fields |

## Implementation Plan

### Phase 1: Database Schema Changes

Create migration: `packages/database/supabase/migrations/YYYYMMDDHHMMSS_api-key-scopes-rate-limits.sql`

```sql
ALTER TABLE "apiKey"
ADD COLUMN "scopes" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN "rateLimit" INTEGER NOT NULL DEFAULT 1000,
ADD COLUMN "rateLimitWindow" TEXT NOT NULL DEFAULT '1h',
ADD COLUMN "expiresAt" TIMESTAMP WITH TIME ZONE,
ADD COLUMN "lastUsedAt" TIMESTAMP WITH TIME ZONE;
```

**Scope format** (mirrors userPermission structure):
```json
{
  "sales_view": ["<companyId>"],
  "sales_create": ["<companyId>"],
  "inventory_view": ["<companyId>"],
  "accounting_view": []
}
```

### Phase 2: SQL Functions for API Key Scope Checking

Add new function to retrieve API key scopes:
```sql
CREATE OR REPLACE FUNCTION get_api_key_scopes() RETURNS JSONB
LANGUAGE "plpgsql" SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  scopes JSONB;
BEGIN
  SELECT "scopes" INTO scopes
  FROM "apiKey"
  WHERE "key" = (current_setting('request.headers'::text, true)::json ->> 'api-key')::text;
  RETURN COALESCE(scopes, '{}'::jsonb);
END;
$$;
```

**Modify** `get_companies_with_employee_permission()` to check API key scopes:
```sql
-- Current (bypasses permissions):
IF api_key_company IS NOT NULL THEN
  RETURN ARRAY[api_key_company];
END IF;

-- New (checks scopes):
IF api_key_company IS NOT NULL THEN
  IF (get_api_key_scopes()->>permission) IS NOT NULL
     AND api_key_company = ANY(jsonb_to_text_array(get_api_key_scopes()->permission)) THEN
    RETURN ARRAY[api_key_company];
  ELSE
    RETURN '{}';
  END IF;
END IF;
```

Apply same pattern to:
- `get_companies_with_employee_role()`
- `get_companies_with_any_role()`

### Phase 3: Application-Level Permission Checking

**Modify** `packages/auth/src/services/auth.server.ts`:

1. Update `getCompanyIdFromAPIKey()` to return scopes and rate limit config
2. Add scope checking in `requirePermissions()` for API key requests
3. Add rate limiting check before processing API key requests

```typescript
// In requirePermissions(), after API key validation:
const scopes = company.data.scopes as Record<string, string[]>;

// Check required permissions against scopes
const hasRequiredScopes = checkApiKeyScopes(scopes, requiredPermissions, companyId);
if (!hasRequiredScopes) {
  throw new Response("API key lacks required permissions", { status: 403 });
}

// Rate limit check
await checkApiKeyRateLimit(apiKey, company.data.rateLimit, company.data.rateLimitWindow);
```

### Phase 4: Rate Limiting Implementation (Dual Layer)

Most API calls go directly to PostgREST/database, bypassing the application layer entirely. Therefore, rate limiting must be implemented at **both** the database and application levels.

#### 4A: Database-Level Rate Limiting

**Challenge**: RLS policy functions are called multiple times per request (once per table). We need to:
1. Track rate limits per API key
2. Only count once per HTTP request (not per table access)
3. Handle sliding window or fixed window semantics

**Solution**: Use a rate limit tracking table + a function that checks the `request.id` to avoid double-counting within the same request.

Create rate limit tracking table:
```sql
CREATE TABLE "apiKeyRateLimit" (
  "apiKeyId" TEXT NOT NULL,
  "windowStart" TIMESTAMP WITH TIME ZONE NOT NULL,
  "requestCount" INTEGER NOT NULL DEFAULT 0,
  "lastRequestId" TEXT,
  CONSTRAINT "apiKeyRateLimit_pkey" PRIMARY KEY ("apiKeyId", "windowStart"),
  CONSTRAINT "apiKeyRateLimit_apiKeyId_fkey" FOREIGN KEY ("apiKeyId")
    REFERENCES "apiKey"("id") ON DELETE CASCADE
);

-- Cleanup old entries periodically (can use pg_cron)
CREATE INDEX "apiKeyRateLimit_windowStart_idx" ON "apiKeyRateLimit" ("windowStart");
```

Create rate limit check function:
```sql
CREATE OR REPLACE FUNCTION check_api_key_rate_limit() RETURNS BOOLEAN
LANGUAGE "plpgsql" SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  api_key_record RECORD;
  current_window_start TIMESTAMP WITH TIME ZONE;
  current_request_id TEXT;
  window_interval INTERVAL;
  current_count INTEGER;
BEGIN
  -- Get API key from header
  SELECT ak.* INTO api_key_record
  FROM "apiKey" ak
  WHERE ak."key" = (current_setting('request.headers'::text, true)::json ->> 'api-key')::text;

  IF api_key_record IS NULL THEN
    RETURN TRUE; -- No API key = not rate limited (handled elsewhere)
  END IF;

  -- Get current request ID to avoid double-counting within same request
  current_request_id := current_setting('request.id', true);

  -- Calculate window interval from rateLimitWindow (e.g., '1h', '1d', '1m')
  window_interval := CASE api_key_record."rateLimitWindow"
    WHEN '1m' THEN INTERVAL '1 minute'
    WHEN '1h' THEN INTERVAL '1 hour'
    WHEN '1d' THEN INTERVAL '1 day'
    ELSE INTERVAL '1 hour'
  END;

  -- Calculate current window start (truncate to window boundary)
  current_window_start := date_trunc(
    CASE api_key_record."rateLimitWindow"
      WHEN '1m' THEN 'minute'
      WHEN '1h' THEN 'hour'
      WHEN '1d' THEN 'day'
      ELSE 'hour'
    END,
    NOW()
  );

  -- Check/insert rate limit entry
  INSERT INTO "apiKeyRateLimit" ("apiKeyId", "windowStart", "requestCount", "lastRequestId")
  VALUES (api_key_record."id", current_window_start, 1, current_request_id)
  ON CONFLICT ("apiKeyId", "windowStart") DO UPDATE
  SET
    "requestCount" = CASE
      WHEN "apiKeyRateLimit"."lastRequestId" = current_request_id THEN "apiKeyRateLimit"."requestCount"
      ELSE "apiKeyRateLimit"."requestCount" + 1
    END,
    "lastRequestId" = current_request_id
  RETURNING "requestCount" INTO current_count;

  -- Check if over limit
  IF current_count > api_key_record."rateLimit" THEN
    RAISE EXCEPTION 'Rate limit exceeded' USING ERRCODE = 'P0001';
  END IF;

  RETURN TRUE;
END;
$$;
```

**Integration with RLS policies**: Call rate limit check in the centralized helper functions:
```sql
-- In get_companies_with_employee_permission():
IF api_key_company IS NOT NULL THEN
  -- Check rate limit first
  PERFORM check_api_key_rate_limit();

  -- Then check scopes...
END IF;
```

**Cleanup job** (optional, using pg_cron if available):
```sql
-- Delete rate limit entries older than 2 days
SELECT cron.schedule('cleanup-api-rate-limits', '0 * * * *', $$
  DELETE FROM "apiKeyRateLimit" WHERE "windowStart" < NOW() - INTERVAL '2 days'
$$);
```

#### 4B: Application-Level Rate Limiting

For routes that go through `requirePermissions()`, also check rate limits in the application layer for better error responses (proper 429 status with headers).

Create `packages/auth/src/services/ratelimit.server.ts`:

```typescript
import { redis } from "@carbon/kv";
import { Ratelimit } from "@upstash/ratelimit";

export async function checkApiKeyRateLimit(
  apiKeyId: string,
  limit: number,
  window: string
): Promise<void> {
  const ratelimit = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(limit, window as "1m" | "1h" | "1d"),
    prefix: "api-key-rl",
  });

  const { success, limit: l, remaining, reset } = await ratelimit.limit(apiKeyId);

  if (!success) {
    throw new Response("Rate limit exceeded", {
      status: 429,
      headers: {
        "X-RateLimit-Limit": l.toString(),
        "X-RateLimit-Remaining": remaining.toString(),
        "X-RateLimit-Reset": reset.toString(),
      },
    });
  }
}
```

#### 4C: Supabase Edge Functions Rate Limiting

For Deno edge functions (e.g., `post-sales-invoice`, `import-csv`), add rate limit checks at the function entry point:

```typescript
// In packages/database/supabase/functions/lib/ratelimit.ts
import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";

const redis = new Redis({
  url: Deno.env.get("UPSTASH_REDIS_REST_URL")!,
  token: Deno.env.get("UPSTASH_REDIS_REST_TOKEN")!,
});

export async function checkRateLimit(
  apiKeyId: string,
  limit: number,
  window: string
): Promise<{ success: boolean; headers: Record<string, string> }> {
  const ratelimit = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(limit, window as Duration),
    prefix: "api-key-rl",
  });

  const result = await ratelimit.limit(apiKeyId);

  return {
    success: result.success,
    headers: {
      "X-RateLimit-Limit": result.limit.toString(),
      "X-RateLimit-Remaining": result.remaining.toString(),
      "X-RateLimit-Reset": result.reset.toString(),
    }
  };
}
```

Usage in edge functions:
```typescript
const auth = await getAuthFromAPIKey(apiKey);
if (auth) {
  const rateCheck = await checkRateLimit(auth.apiKeyId, auth.rateLimit, auth.rateLimitWindow);
  if (!rateCheck.success) {
    return new Response("Rate limit exceeded", { status: 429, headers: rateCheck.headers });
  }
}
```

### Phase 5: UI Updates

**Files to modify:**
- `apps/erp/app/modules/settings/ui/ApiKeys/ApiKeysForm.tsx` - Add scope selection and rate limit config
- `apps/erp/app/modules/settings/ui/ApiKeys/ApiKeysTable.tsx` - Display scope count, rate limit, expiration
- `apps/erp/app/modules/settings/settings.models.ts` - Update apiKeyValidator with new fields
- `apps/erp/app/modules/settings/settings.service.ts` - Update upsertApiKey to handle scopes

**New component:**
- `apps/erp/app/modules/settings/ui/ApiKeys/PermissionMatrix.tsx` - Checkbox grid for module/action selection

### Phase 6: Migration Strategy for Existing API Keys

Grant full access to existing API keys for backward compatibility:

```sql
UPDATE "apiKey"
SET "scopes" = (
  SELECT jsonb_object_agg(
    permission || '_' || action,
    jsonb_build_array("companyId")
  )
  FROM (
    SELECT unnest(ARRAY['sales', 'inventory', 'accounting', 'purchasing', 'parts',
                        'production', 'resources', 'documents', 'settings', 'users',
                        'people', 'timecards', 'scheduling', 'messaging']) as permission,
           unnest(ARRAY['view', 'create', 'update', 'delete']) as action
  ) perms
)
WHERE "scopes" = '{}';
```

## Files to Create/Modify

### Database Layer
| File | Action | Description |
|------|--------|-------------|
| `packages/database/supabase/migrations/XXXXXX_api-key-scopes.sql` | Create | Schema changes (apiKey columns + apiKeyRateLimit table) |
| `packages/database/supabase/migrations/XXXXXX_api-key-rls-functions.sql` | Create | Scope checking + rate limit SQL functions |
| `packages/database/supabase/migrations/XXXXXX_update-rls-helpers.sql` | Create | Modify get_companies_* functions for scope/rate limit checks |

### Application Layer
| File | Action | Description |
|------|--------|-------------|
| `packages/auth/src/services/auth.server.ts` | Modify | Add scope checking + rate limiting for API keys |
| `packages/auth/src/services/ratelimit.server.ts` | Create | Application-level rate limiting utility |

### Edge Functions Layer
| File | Action | Description |
|------|--------|-------------|
| `packages/database/supabase/functions/lib/ratelimit.ts` | Create | Edge function rate limiting utility |
| `packages/database/supabase/functions/lib/supabase.ts` | Modify | Update getAuthFromAPIKey to return scopes/rate limit config |

### UI Layer
| File | Action | Description |
|------|--------|-------------|
| `apps/erp/app/modules/settings/settings.models.ts` | Modify | Update apiKeyValidator |
| `apps/erp/app/modules/settings/settings.service.ts` | Modify | Update upsertApiKey |
| `apps/erp/app/modules/settings/ui/ApiKeys/ApiKeysForm.tsx` | Modify | Add scope/rate limit UI |
| `apps/erp/app/modules/settings/ui/ApiKeys/ApiKeysTable.tsx` | Modify | Add new columns |
| `apps/erp/app/modules/settings/ui/ApiKeys/PermissionMatrix.tsx` | Create | Permission selection grid |
| `apps/erp/app/routes/x+/settings+/api-keys.new.tsx` | Modify | Handle new fields |
| `apps/erp/app/routes/x+/settings+/api-keys.$id.tsx` | Modify | Handle scope editing |

## Verification

### Schema & Migration
1. **Database migration**: Run migration, verify columns added to apiKey table
2. **Rate limit table**: Verify apiKeyRateLimit table created with proper indexes
3. **Existing API keys**: Verify existing keys get full access scopes (backward compatible)

### Scope Enforcement
4. **Scope enforcement - RLS (PostgREST)**:
   - Use API key with only `sales_view` scope
   - Make direct PostgREST request: `GET /rest/v1/salesOrder` - should succeed
   - Make direct PostgREST request: `GET /rest/v1/journal` - should fail (no accounting scope)
5. **Scope enforcement - Application**:
   - Call route requiring `{ view: "accounting" }` with sales-only key
   - Verify 403 response
6. **Scope enforcement - Edge Functions**:
   - Call `post-sales-invoice` with limited scope key
   - Verify appropriate scope checking

### Rate Limiting (Dual Layer)
7. **Rate limiting - Database layer (PostgREST)**:
   - Create key with limit of 5 requests per minute
   - Make 6 direct PostgREST requests
   - Verify 6th request raises PostgreSQL exception
   - Verify apiKeyRateLimit table tracks request counts correctly
   - Verify same request ID doesn't double-count
8. **Rate limiting - Application layer**:
   - Call route through `requirePermissions()`
   - Verify 429 response with proper headers (X-RateLimit-*)
9. **Rate limiting - Edge Functions**:
   - Call edge function with rate-limited API key
   - Verify 429 response

### UI
10. **UI**: Verify permission matrix works correctly, rate limit fields save properly
11. **New API key creation**: Create key with limited scopes via UI
