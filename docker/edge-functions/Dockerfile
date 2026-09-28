# Carbon edge-functions image: the supabase/edge-runtime base with the
# Carbon edge functions baked in at build time, so deploying functions is
# "build, push, helm upgrade" rather than a host bind mount kept in sync.
#
# Build from the repo root — it reads packages/database/supabase/functions:
#   docker build -f docker/edge-functions/Dockerfile -t carbon/edge-functions .
#
# In GovCloud, BASE_IMAGE must point at an ECR mirror of
# supabase/edge-runtime — never Docker Hub.
ARG BASE_IMAGE=supabase/edge-runtime:v1.69.6
ARG DENO_IMAGE=denoland/deno:1.45.2

# --- Module cache warm stage ---------------------------------------------
# The functions import remote modules (deno.land, npm:). Fetching them at
# build time pins what ships and keeps first-invocation latency and runtime
# egress out of the boundary. Failures are tolerated per function (some
# graphs only resolve with env present) — an uncached module falls back to
# a runtime fetch.
FROM ${DENO_IMAGE} AS cache
ENV DENO_DIR=/deno-cache
COPY docker/edge-functions/main /src/main
COPY packages/database/supabase/functions /src/functions
RUN for f in /src/main/index.ts /src/functions/*/index.ts; do \
      [ -f "$f" ] && deno cache "$f" || true; \
    done

# --- Final image ----------------------------------------------------------
FROM ${BASE_IMAGE}

# The upstream edge-runtime base trails Debian bookworm on openssl, gnutls,
# libpam and perl, which scanners flag as fixable CRITICAL/HIGH. Pulling the
# published fixes clears them at the source rather than suppressing them.
USER root
RUN apt-get update \
    && apt-get upgrade -y \
    && rm -rf /var/lib/apt/lists/*

# The main dispatcher (vendored from crbnos/supabase volumes/functions/main).
COPY docker/edge-functions/main /home/deno/functions/main

# The Carbon functions themselves.
COPY packages/database/supabase/functions /home/deno/functions

# Pre-warmed module cache; DENO_DIR points the runtime's module loader at it.
COPY --from=cache /deno-cache /home/deno/.deno-cache
ENV DENO_DIR=/home/deno/.deno-cache

EXPOSE 9000
CMD ["start", "--main-service", "/home/deno/functions/main"]
