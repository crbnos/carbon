<p align="center">
   <a href="https://carbon.ms">
      <img width="auto" height="100" alt="Carbon Logo" src="https://github.com/user-attachments/assets/86a5e583-adac-4bf9-8192-508a0adf2308" />
   </a>
</p>

<p align="center">
    The operating system for manufacturing
    <br />
    <br />
    <a href="https://discord.gg/yGUJWhNqzy">Discord</a>
    ·
    <a href="https://carbon.ms">Website</a>
    ·
    <a href="https://github.com/crbnos/carbon/issues">Issues</a>
  </p>
</p>
<p align="center">
  <img src="https://img.shields.io/badge/Supabase-3ECF8E?style=for-the-badge&logo=supabase&logoColor=white" alt="Supabase" />
  <img src="https://img.shields.io/badge/Typescript-1a67f3?style=for-the-badge&logo=react&logoColor=white" alt="Typescript" />
  <img src="https://img.shields.io/badge/React-23272F?style=for-the-badge&logo=react&logoColor=white" alt="React" />
</p>

![ERP Screenshot](https://github.com/user-attachments/assets/2e09b891-d5e2-4f68-b924-a1c8ea42d24d)

![MES Screenshot](https://github.com/user-attachments/assets/b04f3644-91aa-4f74-af8d-6f3e12116a6b)

## Does the world need another ERP?

We built Carbon after years of building end-to-end manufacturing systems with off-the-shelf solutions. We realized that:

- Modern, API-first tooling didn't exist
- Vendor lock-in bordered on extortion
- There is no "perfect ERP" because each company is unique

We built Carbon to solve these problems ☝️

## Architecture

Carbon is designed to make it easy for you to extend the platform by building your own apps through our API. We provide some examples to get you started in the [examples](https://github.com/crbnos/carbon/blob/main/examples) folder.

![Carbon Functonality](https://github.com/user-attachments/assets/150c3025-ddcb-4ae4-b7b4-27c670d6cb81)

![Carbon Architecture](https://github.com/user-attachments/assets/3674b2d0-28c7-415f-a8ea-4d8c796337eb)

Features:

- [x] ERP
- [x] MES
- [ ] QMS
- [x] Custom Fields
- [x] Nested BoM
- [x] Traceability
- [x] MRP
- [x] Configurator
- [x] MCP Client/Server
- [x] API
- [x] Webhooks
- [ ] Accounting
- [ ] Capacity Planning
- [ ] Simulation
- [ ] [Full Roadmap](https://github.com/orgs/crbnos/projects/1/views/1)

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
- [Stripe](https://stripe.com) - billing

## Codebase

The monorepo follows the Turborepo convention of grouping packages into one of two folders.

1. `/apps` for applications
2. `/packages` for shared code

### `/apps`

| Package Name | Description     | Local Command         |
| ------------ | --------------- | --------------------- |
| `erp`        | ERP Application | `npm run dev`         |
| `mes`        | MES             | `npm run dev:mes`     |
| `academy`    | Academy         | `npm run dev:academy` |
| `starter`    | Starter         | `npm run dev:starter` |

### `/packages`

| Package Name           | Description                                                             |
| ---------------------- | ----------------------------------------------------------------------- |
| `eslint-config-carbon` | Shared, extendable eslint configuration for apps and packages           |
| `@carbon/database`     | Database schema, migrations and types                                   |
| `@carbon/documents`    | Transactional PDFs and email templates                                  |
| `@carbon/ee`           | Integration definitions and configurations                              |
| `@carbon/jest`         | Jest preset configuration shared across apps and packages               |
| `@carbon/jobs`         | Background jobs and workers                                             |
| `@carbon/logger`       | Shared logger used across apps                                          |
| `@carbon/react`        | Shared web-based UI components                                          |
| `@carbon/kv`           | Redis cache client                                                      |
| `@carbon/lib`          | Third-party client libraries (slack, resend)                            |
| `@carbon/stripe`       | Stripe integration                                                      |
| `@carbon/tsconfig`     | Shared, extendable tsconfig configuration used across apps and packages |
| `@carbon/utils`        | Shared utility functions used across apps and packages                  |

## Development

### Setup

1. Clone the repo into a GitHub repository (or fork https://github.com/crbnos/carbon/fork). If you plan to use the code in production, [acquire a commercial license](https://carbon.ms/sales) to comply with the BSL license.

   ```sh
   git clone https://github.com/crbnos/carbon.git
   ```

2. Go to the project folder

   ```sh
   cd carbon
   ```

Make sure that you have [Docker installed](https://docs.docker.com/desktop/install/mac-install/) on your system since this monorepo uses the Docker for local development.

In addition you must configure the following external services:

| Service     | Purpose                    | URL                                                                    |
| ----------- | -------------------------- | ---------------------------------------------------------------------- |
| Upstash     | Serverless Redis           | [https://console.upstash.com/login](https://console.upstash.com/login) |
| Trigger.dev | Job runner                 | [https://cloud.trigger.dev/login](https://cloud.trigger.dev/login)     |
| Posthog     | Product analytics platform | [https://us.posthog.com/signup](https://us.posthog.com/signup)         |

Each of these services has a free tier which should be plenty to support local development. If you're self hosting, and you don't want to use Upstash or Posthog, it's pretty easy to replace upstash with a redis container in `@carbon/kv` and remove the Posthog analytics.

### Installation

First download and initialize the repository dependencies.

```bash
$ nvm use           # use node v20
$ npm install       # install dependencies
$ npm run db:start  # pull and run the containers
```

Create an `.env` file and copy the contents of `.env.example` file into it

```bash
$ cp ./.env.example ./.env
```

1. Use the output of `npm run db:start` to set the supabase entries:

- `SUPABASE_SERVICE_ROLE_KEY=[service_role key]`
- `SUPABASE_ANON_KEY=[anon key]`

2. [Create a Redis database in upstash](https://console.upstash.com/redis) and copy the following from the `REST API` section:

- `UPSTASH_REDIS_REST_URL=[UPSTASH_REDIS_REST_URL]`
- `UPSTASH_REDIS_REST_TOKEN=[UPSTASH_REDIS_REST_TOKEN]`

3. Navigate to the project you created in [https://cloud.trigger.dev/](Trigger.dev) and copy the following from the `Environments & API Keys` section:

- `TRIGGER_PUBLIC_API_KEY=[Public 'dev' API Key, starting 'pk_dev*']`
- `TRIGGER_API_KEY=[Server 'dev' API Key, starting 'tr_dev*']`
- `TRIGGER_PROJECT_ID=[Public 'project' key, starting 'proj*]`

4. In Posthog go to [https://[region].posthog.com/project/[project-id]/settings/project-details](https://[region].posthog.com/project/[project-id]/settings/project-details) to find your Project ID and Project API key:

- `POSTHOG_API_HOST=[https://[region].posthog.com]`
- `POSTHOG_PROJECT_PUBLIC_KEY=[Project API Key starting 'phc*']`

5. Add a `STRIPE_SECRET_KEY` from the Stripe admin interface, and then run `npm run -w @carbon/stripe register:stripe` to get a `STRIP_WEBHOOK_SECRET`

- `STRIPE_SECRET_KEY="sk_test_*************"`
- `STRIP_WEBHOOK_SECRET="whsec_************"`

6. Signing in requires you to setup one of two methods:
   - Email requires a Resend API key:
     - `RESEND_API_KEY="re_**********"`
     - `RESEND_DOMAIN="carbon.ms"`
   - Sign-in with Google requires a [Google auth client](https://supabase.com/docs/guides/auth/social-login/auth-google) with these variables:
     - `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID="******.apps.googleusercontent.com"`
     - `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET="GOCSPX-****************"`
     - `SUPABASE_AUTH_EXTERNAL_GOOGLE_REDIRECT_URI="http://127.0.0.1:54321/auth/v1/callback"`

Then you can run the following:

```bash
$ npm run db:build     # run db migrations and seed script
$ npm run build        # build the packages
```

Finally, start the apps and packages:

```bash
$ npm run dev
$ npm run dev:mes        # npm run dev in all apps & packages
```

After installation you should be able run the apps locally.

| Application     | URL                                                                                                                |
| --------------- | ------------------------------------------------------------------------------------------------------------------ |
| ERP             | [http://localhost:3000](http://localhost:3000)                                                                     |
| MES             | [http://localhost:3001](http://localhost:3001)                                                                     |
| Academy         | [http://localhost:4111](http://localhost:4111)                                                                     |
| Starter         | [http://localhost:4000](http://localhost:4000)                                                                     |
| Postgres        | [postgresql://postgres:postgres@localhost:54322/postgres](postgresql://postgres:postgres@localhost:54322/postgres) |
| Supabase Studio | [http://localhost:54323/project/default](http://localhost:54323/project/default)                                   |
| Mailpit         | [http://localhost:54324](http://localhost:54324)                                                                   |
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

## API

The API documentation is located in the ERP app at `${ERP}/x/api/js/intro`. It is auto-generated based on changes to the database.

There are two ways to use the API:

1. From another codebase using a supabase client library:

- [Javascript](https://supabase.com/docs/reference/javascript/introduction)
- [Flutter](https://supabase.com/docs/reference/dart/introduction)
- [Python](https://supabase.com/docs/reference/python/introduction)
- [C#](https://supabase.com/docs/reference/csharp/introduction)
- [Swift](https://supabase.com/docs/reference/swift/introduction)
- [Kotlin](https://supabase.com/docs/reference/kotlin/introduction)

2. From within the codebase using our packages.

### From another Codebase

First, set up the necessary credentials in environment variables. For the example below:

1. Navigate to settings in the ERP to generate an API key. Set this in `CARBON_API_KEY`
2. Get the Supabase URL to call (this is `SUPABASE_URL` in your `.env` if hosting locally, e.g. http://localhost:54321). Set this as `CARBON_API_URL`.
3. Get the `SUPABASE_ANON_KEY` e.g. from your .env file. Set this as `CARBON_PUBLIC_KEY`.

If you're self-hosting you can also use the supabase service key instead of the public key for root access. In that case you don't need to include the `carbon-key` header.

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
