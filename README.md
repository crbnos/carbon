![Carbon](https://github.com/user-attachments/assets/e7a06b25-c82e-496d-b4c0-d97f10438ce5)

Carbon is the open-source operating system for manufacturing.

## Architecture

![Carbon Architecture](https://github.com/user-attachments/assets/ed6dc66b-e9cb-435e-b5a9-9daf933f4a1d)

Features:

- [x] ERP
- [x] MES
- [x] Custom Fields
- [x] Nested BoM
- [x] Traceability
- [x] Configurator
- [x] MCP Client/Server
- [x] API
- [x] Webhooks
- [x] Purchase Planning
- [ ] Accounting

Technical highlights:

- [x] Unified auth and permissions across apps
- [x] Full-stack type safety (Database → UI)
- [x] Realtime database subscriptions
- [x] Attribute-based access control (ABAC)
- [x] Role-based access control (Customer, Supplier, Employee)
- [x] Row-level security (RLS)
- [x] Composable user groups
- [x] Dependency graph for operations
- [x] Third-party integrations

## Techstack

- [Remix](https://remix.run) – framework
- [Typescript](https://www.typescriptlang.org/) – language
- [Tailwind](https://tailwindcss.com) – styling
- [Radix UI](https://radix-ui.com) - behavior
- [Supabase](https://supabase.com) - database
- [Supabase](https://supabase.com) – auth
- [Upstash](https://upstash.com) - cache
- [Trigger](https://trigger.dev) - jobs
- [Resend](https://resend.com) – email
- [Novu](https://novu.co) – notifications
- [Vercel](https://vercel.com) – hosting

## Codebase

The monorepo follows the Turborepo convention of grouping packages into one of two folders.

1. `/apps` for applications
2. `/packages` for shared code

### `/apps`

| Package Name | Description     | Local Command            |
| ------------ | --------------- | ------------------------ |
| `erp`        | ERP Application | `npm run dev`            |
| `mes`        | MES             | `npm run dev:mes`        |
| `univeristy` | University      | `npm run dev:university` |
| `starter`    | Starter         | `npm run dev:starter`    |

### `/packages`

| Package Name           | Description                                                             |
| ---------------------- | ----------------------------------------------------------------------- |
| `eslint-config-carbon` | Shared, extendable eslint configuration for apps and packages           |
| `@carbon/database`     | Database schema, migrations and types                                   |
| `@carbon/documents`    | Transactional PDFs and email templates                                  |
| `@carbon/jest`         | Jest preset configuration shared across apps and packages               |
| `@carbon/logger`       | Shared logger used across apps                                          |
| `@carbon/react`        | Shared web-based UI components                                          |
| `@carbon/kv`           | Redis cache client                                                      |
| `@carbon/lib`          | Third-party client libraries (slack, resend, stripe)                    |
| `@carbon/tsconfig`     | Shared, extendable tsconfig configuration used across apps and packages |
| `@carbon/utils`        | Shared utility functions used across apps and packages                  |

## API

The API documentation is located in the ERP app at `/x/api/js/intro`. It is auto-generated based on changes to the database.

### From another Codebase

Navigate to settings in the ERP to generate an API key. If you're self-hosting you can also use the supabase service key instead of the public key for root access. In that case you don't needto include the `carbon-key` header.

```ts
import { Database } from "@carbon/database";
import { createClient } from "@supabase/supabase-js";

const apiKey = process.env.CARBON_API_KEY;
const apiUrl = process.env.CARBON_API_URL;
const publicKey = process.env.CARBON_PUBLIC_KEY;

const carbon = createClient<Database>(apiUrl, publicKey, {
  global: {
    headers: {
      "carbon-key": apiKey,
    },
  },
});

// returns items from the company associated with the api key
const { data, error } = await carbon.from("item").select("*");
```

### From the Monorepo

```tsx
import { getCarbonServiceRole } from "@carbon/auth";
const carbon = getCarbonServiceRole();

// returns all items across companies
const { data, error } = await carbon.from("item").select("*");

// returns items from a specific company
const companyId = "xyz";
const { data, error } = await carbon
  .from("item")
  .select("*")
  .eq("companyId", companyId);
```

## Local Development

Make sure that you have [Docker installed](https://docs.docker.com/desktop/install/mac-install/) on your system since this monorepo uses the Docker for local development.

In addition you must configure the following external services:

| Service     | Purpose                    | URL                                                                    |
| ----------- | -------------------------- | ---------------------------------------------------------------------- |
| Upstash     | Serverless Redis           | [https://console.upstash.com/login](https://console.upstash.com/login) |
| Trigger.dev | Job runner                 | [https://cloud.trigger.dev/login](https://cloud.trigger.dev/login)     |
| Posthog     | Product analytics platform | [https://us.posthog.com/signup](https://us.posthog.com/signup)         |

Each of these services has a free tier which should be plenty to support local development.

### Installation

First download and initialize the repository dependencies.

```bash
$ nvm use           # use node v20
$ npm install       # install dependencies
$ npm run db:start  # pull and run the containers
```

Create an `.env` file and copy the contents of `.env.example` file into it

````bash
$ cp ./.env.example ./.env

1. Set your email address:
- `DEFAULT_EMAIL_ADDRESS=[your-email@address.com]`

2. Use the output of `npm run db:start` to set the supabase entries:

- `SUPABASE_SERVICE_ROLE_KEY=[service_role key]`
- `SUPABASE_ANON_KEY=[anon key]`

3. [Create a Redis database in upstash](https://console.upstash.com/redis) and copy the following from the `REST API` section:

- `UPSTASH_REDIS_REST_URL=[UPSTASH_REDIS_REST_URL]`
- `UPSTASH_REDIS_REST_TOKEN=[UPSTASH_REDIS_REST_TOKEN]`

4. Navigate to the project you created in [https://cloud.trigger.dev/](Trigger.dev) and copy the following from the `Environments & API Keys` section:

- `TRIGGER_PUBLIC_API_KEY=[Public 'dev' API Key, starting 'pk_dev*']`
- `TRIGGER_API_KEY=[Server 'dev' API Key, starting 'tr_dev*']`

5. In Posthog go to [https://[region].posthog.com/project/[project-id]/settings/project-details](https://[region].posthog.com/project/[project-id]/settings/project-details) to find your Project ID and Project API key:

- `POSTHOG_API_HOST=[https://[region].posthog.com]`
- `POSTHOG_PROJECT_PUBLIC_KEY=[Project API Key starting 'phc*']`

Then you can run the following:

```bash
$ npm run db:build     # run db migrations and seed script
$ npm run build        # build the packages
````

Finally, start the apps and packages:

```bash
$ npm run dev
$ npm run dev:mes        # npm run dev in all apps & packages
```

You can now sign in with:

username: <your-email@address.com>
password: carbon

After installation you should be able run the apps locally.

| Application     | URL                                                                                                                |
| --------------- | ------------------------------------------------------------------------------------------------------------------ |
| ERP             | [http://localhost:3000](http://localhost:3000)                                                                     |
| MES             | [http://localhost:3001](http://localhost:3001)                                                                     |
| University      | [http://localhost:4111](http://localhost:4111)                                                                     |
| Starter         | [http://localhost:4000](http://localhost:4000)                                                                     |
| Postgres        | [postgresql://postgres:postgres@localhost:54322/postgres](postgresql://postgres:postgres@localhost:54322/postgres) |
| Supabase Studio | [http://localhost:54323/project/default](http://localhost:54323/project/default)                                   |
| Inbucket        | [http://localhost:54324/monitor](http://localhost:54324/monitor)                                                   |
| Edge Functions  | [http://localhost:54321/functions/v1/<function-name>](http://localhost:54321/functions/v1/<function-name>)         |

### Notes

To kill the database containers in a non-recoverable way, you can run:

```bash
$ npm run db:kill   # stop and delete all database containers
```

To restart and reseed the database, you can run:

```bash
$ npm run db:build # runs db:kill, db:start, and setup
```

To run a particular application, use the `-w workspace` flag.

For example, to run test command in the `@carbon/react` package you can run:

```
$ npm run test -w @carbon/react
```

To run Stripe locally, run:

```
$ npm run -w erp register:stripe
$ npm run -w erp dev:stripe
```

### Restoring a Production Database Locally

1. Download the production database backup from Supabase
2. Rename the migrations folder to `_migrations`
3. Restore the database using the following command:

```bash
$ npm run db:build # this should error out at the seed step
PGPASSWORD=postgres psql -h localhost -p 54322 -U supabase_admin -d postgres < ~/Downloads/db_cluster-15-02-2025@04-37-58.backup
$ npm run dev
```

4. Rename the `_migrations` folder back to `migrations`
