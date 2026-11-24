---
paths: ["packages/dev/docker/envoy/cds.template.yaml", "packages/dev/docker/docker-compose.dev.yml"]
triggers: ["carbon-shared", "local-edge-runtime", "container_name"]
promoted: null
---
# On carbon-shared, a shared service's bare name answers in every worktree

**Context:** Envoy's `functions` cluster listed the worktree's private
`edge-runtime` first and the shared `carbon-edge-runtime` second.

**Problem:** crbn-shared's service is also called `edge-runtime` and joins
`carbon-shared`, which every worktree's gateway joins too. With no private runtime
the bare name resolved to the shared one; with one, Docker happened to answer with
the private one only. "Private first" depended on Docker's DNS order, and the
fallback was never used.

**Rule:** A worktree container on `carbon-shared` reaches its own services by a
`local-*` alias on its default network (`local-meta`, `local-edge-runtime`), and
shared ones by `container_name` (`carbon-*`). Check a new name with
`docker exec <api-gw> getent ahostsv4 <name>` with and without the other side up.

**Applies to:** `packages/dev/docker/envoy/cds.template.yaml`,
`packages/dev/docker/docker-compose.dev.yml`, `.claude/rules/dev-shared-services.md`.
