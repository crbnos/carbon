# Local Development

This guide gets Carbon running from the current checkout. Carbon's `crbn` CLI
starts an isolated Docker/Supabase stack, applies migrations, generates database
types, and launches the ERP and/or MES applications.

## Prerequisites

Install these before continuing:

- Git
- nvm (the commands below use it to select the repository's Node version)
- Node.js 22 (`.nvmrc` contains `v22`)
- Docker Desktop on macOS/Windows, or Docker Engine on Linux
- Corepack, included with Node.js
- A POSIX shell: macOS, Linux, WSL, or Git Bash

Native PowerShell and `cmd.exe` are not supported by the development CLI. Make
sure Docker is running before starting Carbon.

## First-time setup

From the repository root:

```bash
nvm use
corepack enable
pnpm install
source ./setup.sh
cp .env.example .env
```

`source ./setup.sh` installs the `crbn` command and activates it in the current
shell. If you run `./setup.sh` instead, open a new shell or source your shell's
rc file afterward.

For the default local login, the placeholder values in `.env.example` are
enough. At minimum, keep non-empty values for required settings such as
`SESSION_SECRET`, `POSTHOG_PROJECT_PUBLIC_KEY`, and `RESEND_API_KEY`; the app
validates several variables as soon as it boots. Use real credentials only when
testing the corresponding external service.

Keep genuine secrets in `.env`. Do not add local ports, URLs, Supabase keys,
Redis settings, or Inngest settings there—`crbn up` generates those values in
`.env.local` for the current checkout. Do not edit or commit `.env.local`.

## Start Carbon

Confirm Docker is running, then execute:

```bash
crbn up
```

Choose ERP, MES, or both in the prompt. The first run may take several minutes
while Docker images are downloaded and the database is initialized. Subsequent
runs reuse the installed dependencies, images, and database volume.

For a non-interactive ERP + MES start:

```bash
crbn up --all
```

When startup finishes, `crbn` prints the URLs for the applications and local
services. They normally follow this pattern:

| Service | URL |
| --- | --- |
| ERP | `https://<checkout>.erp.dev` |
| MES | `https://<checkout>.mes.dev` |
| Supabase Studio | `https://<checkout>.studio.dev` |
| Inngest | `https://<checkout>.inngest.dev` |
| Local email | `https://<checkout>.mail.dev` |

The exact URLs and dynamically allocated ports are always available with:

```bash
crbn status
```

The main checkout may use the shorter `https://erp.dev` and
`https://mes.dev` aliases.

## Log in

1. Open the ERP URL printed by `crbn up`.
2. Enter `test@carbon.ms` in the email field.
3. Select **Sign in with Email**.

`crbn up` seeds this user and writes the local-only bypass configuration into
`.env.local`, so no email provider is required. Other email addresses use the
normal magic-link flow; development messages appear in the local email service.
The authenticated session also works in MES.

## Daily commands

```bash
crbn up                 # start the stack and select applications
crbn up --all           # start ERP and MES without a prompt
crbn up --no-apps       # start backing services only
crbn status             # show URLs, ports, and container health
crbn down               # stop containers and preserve local data
crbn reset              # erase this checkout's local data and start fresh
pnpm db:migrate         # apply new migrations to the running stack
pnpm run generate:types # regenerate database types after schema changes
```

Stopping the foreground `crbn up` process also tears down its application
processes. Use `crbn down` if backing services remain active.

## Troubleshooting

### `crbn` is not found

Activate the installed shell configuration:

```bash
source ./setup.sh
```

Alternatively, open a new terminal after running `./setup.sh`.

### Docker is unavailable

Start Docker Desktop or the Docker daemon, verify `docker info` succeeds, and
run `crbn up` again.

### `*.dev` certificate or routing problems

The default setup uses Portless for local HTTPS. Let `setup.sh` complete its
Portless installation and approve any requested system permissions. If local
HTTPS is not usable in your environment, start with direct localhost URLs:

```bash
crbn up --no-portless
```

### A migration or generated type is stale

With the stack running:

```bash
pnpm db:migrate
pnpm run generate:types
```

Do not rebuild or reset the database merely to apply a migration. `crbn reset`
is destructive and should only be used when you intentionally want fresh data.

### Inspect service state and logs

Start with:

```bash
crbn status
```

The status output identifies the checkout's Compose project and assigned ports.
Use standard Docker tooling against that project if deeper inspection is
needed.

## Optional: 3D assembly service

ERP and MES run without the Rust assembler. To enable STEP-to-GLB conversion and
assembly motion planning on macOS, install the native dependencies and perform
the one-time OpenCASCADE build:

```bash
brew install fcl cmake ninja
./apps/assembler/scripts/build-occt.sh
cargo build --release -p assembler
```

Then select **Assembler** when running `crbn up`. Linux requires the equivalent
FCL, libccd, Eigen, Octomap, CMake, Ninja, and C/C++ development packages. See
the assembler section in the main [README](README.md#optional-the-assembler-geometry-service)
for platform details.

## Validate a change

Use the smallest validation scope relevant to your work:

```bash
pnpm exec turbo run typecheck --filter=erp
pnpm exec turbo run typecheck --filter=mes
pnpm --filter @carbon/react test
pnpm run lint
```

Avoid the whole-repository typecheck for routine changes because it can exhaust
available memory.
