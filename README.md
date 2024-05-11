<p align="center">
<a href="https://www.loom.com/share/7eb03a5e4d4d4836b34f173805fb7403?sid=7ed308d0-8d59-4230-a3f1-137aae3c24da" target="_blank">
  <img src="https://github.com/barbinbrad/carbon/assets/64510427/229985c9-44de-4b2b-afdd-7d1f4fd9dedd" width="70%" />
</a>
</p>

# Carbon ERP

Carbon is a high performance, open-source, single tenant (incomplete) ERP written in Typescript. It allows customers, suppliers, and employees to share a common platform that's easy to integrate with.

Technical highlights/roadmap:

- [x] Full-stack type safety (Database → UI)
- [x] Realtime database subscriptions
- [x] Attribute-based access control (ABAC)
- [x] Row-level security (RLS)
- [x] Composable user groups
- [x] Magic link authentication
- [x] File-based routing
- [ ] Third-party integrations for data
- [ ] Easy-to-use plugin system

Product highlights/roadmap are:

- [x] Search
- [x] Customer and supplier access
- [x] Double-entry accrual accounting
- [ ] Stochastic scheduling/planning
- [ ] Graph-based routing for manufacturing

## Project Status

- [x] Pre-Alpha: Developing foundation
- [x] Alpha: Heavy feature development and refinement
- [ ] Public Alpha: Ready for use. But go easy on us, there'll be bugs.
- [ ] Public Beta: Stable enough for most non-enterprise use-cases.
- [ ] Public: Production-ready

## Techstack

- [Remix](https://remix.run) – framework
- [Typescript](https://www.typescriptlang.org/) – language
- [Tailwind](https://tailwindcss.com) – styling
- [Radix UI](https://radix-ui.com) - behavior
- [Supabase](https://supabase.com) - database
- [Supabase](https://supabase.com) – auth
- [Redis](https://redis.io) - cache
- [Trigger](https://trigger.dev) - jobs
- [Resend](https://resend.com) – email
- [Vercel](https://vercel.com) – hosting

## Codebase

The monorepo follows the Turborepo convention of grouping packages into one of two folders.

1. `/apps` for applications
2. `/packages` for shared code

### `/apps`

| Package Name | Description     | Local Command         |
| ------------ | --------------- | --------------------- |
| `carbon`     | ERP Application | `npm run dev`         |
| `docs`       | Documentation   | `npm run dev:docs`    |
| `website`    | Website         | `npm run dev:website` |

### `/packages`

| Package Name           | Description                                                             |
| ---------------------- | ----------------------------------------------------------------------- |
| `eslint-config-carbon` | Shared, extendable eslint configuration for apps and packages           |
| `@carbon/database`     | Database schema, migrations and types                                   |
| `@carbon/documents`    | Transactional PDFs and email templates                                  |
| `@carbon/jest`         | Jest preset configuration shared across apps and packages               |
| `@carbon/logger`       | Shared logger used across apps                                          |
| `@carbon/react`        | Shared web-based UI components                                          |
| `@carbon/redis`        | Redis cache client                                                      |
| `@carbon/tsconfig`     | Shared, extendable tsconfig configuration used across apps and packages |
| `@carbon/utils`        | Shared utility functions used across apps and packages                  |

## Local Development

Make sure that you have [Docker installed](https://docs.docker.com/desktop/install/mac-install/) on your system since this monorepo uses the Docker for local development.

After installation you should be able to access the following apps/containers locally:

| Application     | URL                                                                                                                |
| --------------- | ------------------------------------------------------------------------------------------------------------------ |
| Carbon ERP      | [http://localhost:3000](http://localhost:3000)                                                                     |
| Postgres        | [postgresql://postgres:postgres@localhost:54322/postgres](postgresql://postgres:postgres@localhost:54322/postgres) |
| Supabase Studio | [http://localhost:54323/project/default](http://localhost:54323/project/default)                                   |
| Inbucket        | [http://localhost:54324/monitor](http://localhost:54324/monitor)                                                   |
| Edge Functions  | [http://localhost:54321/functions/v1/<function-name>](http://localhost:54321/functions/v1/<function-name>)         |

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

```bash
$ cp ./.env.example ./.env
```

1. Use the output of `npm run db:start` to set the supabase entries:

- SUPABASE_SERVICE_ROLE=[service_role key]
- SUPABASE_ANON_PUBLIC=[anon key]

2. [Create a Redis database in upstash](https://console.upstash.com/redis) and copy the following from the `REST API` section:

- UPSTASH_REDIS_REST_URL=[UPSTASH_REDIS_REST_URL]
- UPSTASH_REDIS_REST_TOKEN=[UPSTASH_REDIS_REST_TOKEN]]

3. Navigate to the project you created in [https://cloud.trigger.dev/](Trigger.dev) and copy the following from the `Environments & API Keys` section:

- TRIGGER*PUBLIC_API_KEY=[Public 'dev' API Key, starting 'pk_dev*']
- TRIGGER*API_KEY=[Server 'dev' API Key, starting 'tr_dev*']

4. In Posthog go to [https://[region].posthog.com/project/[project-id]/settings/project-details](https://[region].posthog.com/project/[project-id]/settings/project-details) to find your Project ID and Project API key:

- POSTHOG_API_HOST=[https://[region].posthog.com]
- POSTHOG*PROJECT_PUBLIC_KEY=[Project API Key starting 'phc*']

Then you can run the following:

```bash
$ npm run db:build     # run db migrations and seed script
$ npm run build        # build the packages
```

Finally, start the apps and packages:

```bash
$ npm run dev         # npm run dev in all apps & packages
```

You can now sign in with:

username: admin@carbon.us.org
password: carbon

Go ahead and create your own user account

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

### Or run with the `launcher.sh` script

```
chmod +x launcher.sh # make the file executable
./launcher.sh
```
