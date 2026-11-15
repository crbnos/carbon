# Bugfix run: crbn up Studio health and shared configuration

- Date: 2026-11-15
- Mode: fully autonomous (user approved the required Compose edit and shared restart)
- Request: "fix the issues with crbn up"
- Phase plan: root-cause run; instrument skip (direct container probes proved the cause); fix run; browser test skip (container and gateway checks directly prove it); commit skip (not requested)

## Root-cause brief

**Bug:** `crbn up --all` reports an unhealthy Studio and warns that shared files differ.

**Studio cause (HIGH):** The Supabase Studio image's healthcheck fetches `http://localhost:3000/api/platform/profile`. Inside the running container, `localhost:3000` returns `ECONNREFUSED`, while the same path at the container hostname returns HTTP 200. Next.js binds to that hostname, so the built-in image probe marks a serving container unhealthy. The fix is a Compose healthcheck override using the reachable hostname.

**Shared warning cause (HIGH):** `~/.carbon/shared/docker-compose.shared.yml` still has tag-only image names, while this checkout pins the same images by digest. `prepareShared()` deliberately refuses to replace a differing Compose file while shared services are running. Another worktree uses those services. The user approved a brief restart that preserves volumes so `crbn up` can copy the current file.

## Proof

- Before Studio fix: Docker health status `unhealthy`; repeated probe failure `ECONNREFUSED 127.0.0.1:3000`; direct inside-container probe `localhost ECONNREFUSED`, hostname `200`.
- Before shared restart: `diff -u` shows only tag-to-digest image reference changes; `crbn up` prints the shared-files warning.

## Decisions

- Do not run migrations or regenerate types while this worktree's migration is being edited.
- Preserve the other worktree's databases by restarting `crbn-shared` without `-v`.

## Outcome

- READY. `packages/dev/docker/docker-compose.dev.yml` overrides Studio's image healthcheck with a probe to the container hostname. After `crbn reload studio`, Docker reports `healthy` and the Studio API responds 200 on the published port.
- `crbn-shared` was stopped without `-v`, its Compose file was updated to this checkout's pinned image references, and it was restarted with `--wait`. Every shared service reached healthy state; the shared file now matches the source, so `prepareShared()` has no changed file to warn about. ERP login responds 200.
- Verification: `pnpm --filter @carbon/dev typecheck` passed; `pnpm --filter @carbon/dev test` passed (20 files, 169 tests) outside the sandbox after socket-based tests were blocked inside it; `docker compose ... config --quiet` passed; `git diff --check` passed. Biome ignores the Compose YAML.
- No migrations, type regeneration, commits, or changes to the other worktree's files.
