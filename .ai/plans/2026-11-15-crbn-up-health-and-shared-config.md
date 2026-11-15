# Fix crbn up health and shared configuration

- [x] Diagnose the active `crbn up` run and preserve unrelated worktree edits.
- [x] Override Studio's image healthcheck in `packages/dev/docker/docker-compose.dev.yml` to probe the container hostname, which serves `/api/platform/profile` with HTTP 200.
- [x] Run the scoped `@carbon/dev` checks and recreate only Studio; confirm Docker reports it healthy.
- [x] Restart `crbn-shared` without deleting volumes, install the current pinned Compose file, and confirm the copied file matches, the shared services are healthy, and this worktree's endpoints respond.

The active run uses `--no-migrate --no-regen`; retain those options during verification because a migration is being edited in this worktree.
