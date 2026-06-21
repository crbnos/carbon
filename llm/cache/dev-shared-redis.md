# Dev shared redis

One redis per host, shared across all worktrees (each worktree uses a logical
DB index 0–15 via `REDIS_URL=redis://localhost:6379/<db>`).

As of commit `15c48ed9f` it is **NOT** a compose service. The root
`docker-compose.yml` (which held only this one service) was deleted. The dev CLI
boots it directly:

- `bootSharedRedis()` in `packages/dev/src/services/compose.ts` — `docker run`
  the `carbon-redis` container (image `redis:7-alpine`, volume `carbon-redis-data`,
  port `SHARED_REDIS_PORT` = 6379, `--appendonly yes`, healthcheck `redis-cli ping`).
  Idempotent: reuse a running container, start a stopped one, else create.
- Called from `packages/dev/src/commands/up.ts` ("Boot shared redis" task).
- `flushDb(db)` in the same file execs `redis-cli -n <db> FLUSHDB` in `carbon-redis`.
- Container name/volume consts live at the top of `compose.ts`
  (`REDIS_CONTAINER`, `REDIS_VOLUME`).

The per-worktree Supabase + inngest stack is still a compose file
(`packages/dev/docker/docker-compose.dev.yml`, `COMPOSE_DEV_FILE`). Only redis
was extracted. The CLI invokes it with `--project-directory .` (cwd = repo root)
so the file's `./packages/...` mounts resolve from root despite the file living
under `packages/dev/docker/`.

Note: the old compose created volume `carbon-shared_redis-data`; the new path
uses `carbon-redis-data`. Old volume is orphaned (harmless), dev redis is cache.

Unrelated pre-existing flaky test: `packages/dev/src/worktree.test.ts >
sameWorktreePath` fails in `afterAll` rmSync ("Path is a directory") on clean
main — not caused by the redis change.
