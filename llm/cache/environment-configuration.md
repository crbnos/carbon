# Environment Variables and Configuration

## Environment Variable Management

### File Structure

- **Root `.env` file**: Main environment configuration file at `./.env`
- **`.env.example`**: Template file showing all required environment variables
- **Symlinks**: Apps and packages use symlinks to the root `.env` file for consistency

### Key Environment Files

1. `./.env` - Main configuration (gitignored)
2. `./.env.example` - Template with all required variables
3. `./.env.production` - Production-specific settings
4. App-specific symlinks:
   - `/apps/erp/.env` → symlink to root `.env`
   - `/apps/mes/.env` → symlink to root `.env`
   - `/apps/starter/.env` → symlink to root `.env`
   - `/packages/database/.env` → symlink to root `.env`
   - `/packages/kv/.env` → symlink to root `.env`

### Environment Variable Categories

#### Authentication & Security

- `SESSION_SECRET` - Required for session management
- `SUPABASE_ANON_KEY` - Public Supabase key
- `SUPABASE_SERVICE_ROLE_KEY` - Supabase admin key (server-only)
- `SUPABASE_URL` - Supabase instance URL

#### External Services

- `RESEND_API_KEY` - Email service API key
- `NOVU_APPLICATION_ID` & `NOVU_SECRET_KEY` - Notification service
- `POSTHOG_API_HOST` & `POSTHOG_PROJECT_PUBLIC_KEY` - Analytics
- `SLACK_BOT_TOKEN` - Slack integration
- `TRIGGER_ID`, `TRIGGER_API_KEY`, `TRIGGER_API_URL`, `TRIGGER_PUBLIC_API_KEY` - Trigger.dev job queue
- `UPSTASH_REDIS_REST_URL` & `UPSTASH_REDIS_REST_TOKEN` - Redis KV store
- `ONSHAPE_SECRET_KEY` - CAD integration
- `EXCHANGE_RATES_API_KEY` - Currency exchange rates

#### Stripe (Prepared but not integrated)

- Future variables will include:
  - `STRIPE_SECRET_KEY`
  - `STRIPE_WEBHOOK_SECRET`

#### Configuration

- `VERCEL_URL` - Deployment URL
- `VERCEL_ENV` - Deployment environment (production/preview/development)

## Central Configuration Pattern

### Main Configuration File

`/packages/auth/src/config/env.ts` serves as the central environment configuration:

1. **Type-safe environment access**: Provides TypeScript interfaces for all env vars
2. **getEnv() utility**: Centralized function for accessing environment variables with options:
   - `isRequired`: Whether the variable must be set
   - `isSecret`: Whether the variable should be hidden from client-side code
3. **Browser vs Server**: Handles different environments appropriately
4. **Exports all environment constants**: Other packages import from here

### Usage Pattern

```typescript
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from "@carbon/auth/config";
```

### Direct Usage

Some services access `process.env` directly:

- `/apps/erp/app/lib/resend.server.ts` - Uses `process.env.RESEND_API_KEY`

## Setup Process

### Automatic Setup Script

`/scripts/setup-env-files.ts` automates environment setup:

1. Creates symlinks from apps/packages to root `.env`
2. Updates `seed.sql` with the configured email address
3. Ensures consistency across the monorepo

### Manual Setup

1. Copy `.env.example` to `.env`
2. Fill in all required values
3. Run `npm run setup:env` to create symlinks

## Security Considerations

1. **Client vs Server Variables**:
   - Public variables exposed to browser via `getBrowserEnv()`
   - Secret variables only accessible server-side
2. **Git Security**: All `.env` files are gitignored
3. **Type Safety**: TypeScript interfaces prevent typos and ensure all required vars are set
4. **Validation**: `getEnv()` throws errors for missing required variables

## Development vs Production

- Development: Uses `http://localhost:3000` and local Supabase instance
- Preview: Uses Vercel preview URLs
- Production: Uses `https://app.carbon.ms` and production services

## Adding New Environment Variables

1. Add to `.env.example` with placeholder value
2. Add TypeScript interface in `/packages/auth/src/config/env.ts`
3. Export constant using `getEnv()` function
4. Import and use from `@carbon/auth/config` in your code
