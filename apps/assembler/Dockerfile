# syntax=docker/dockerfile:1.7
# Carbon assembler service (Rust): STEP -> GLB + assembly graph, and
# collision-free disassembly motion planning.
#
# OCCT is STATIC-LINKED into the binary from the prebuilt carbon-occt base
# image (OCCT V8_0_0_p1 + the CommonBaseAllocator thread_local patch — see
# occt.Dockerfile). Build that base ONCE and keep it:
#   docker build -f apps/assembler/occt.Dockerfile -t carbon-occt:8.0.0-p1 apps/assembler
# Then this image builds in ~minutes (cargo cache mounts make code-only
# rebuilds seconds), and the runtime stage is a slim image with just the FCL
# collision libs + the stripped binary — no OCCT shared objects, no X11.
#
# Build from the REPO ROOT (the cargo workspace spans crates/* + apps/assembler):
#   docker build -f apps/assembler/Dockerfile -t carbon-assembler .
# Override the base tag with --build-arg OCCT_IMAGE=<registry>/carbon-occt:TAG.

ARG OCCT_IMAGE=carbon-occt:8.0.0-p1

# ---- prebuilt static OCCT (kept base image; no source compile) ----
FROM ${OCCT_IMAGE} AS occt

# ---- Rust builder ----
FROM rust:1.90-bookworm AS build
RUN apt-get update && apt-get install -y --no-install-recommends \
      libfcl-dev libccd-dev libeigen3-dev liboctomap-dev \
      libopenblas-dev gfortran \
    && rm -rf /var/lib/apt/lists/*
COPY --from=occt /opt/occt /opt/occt
WORKDIR /app
# Only the Rust workspace — not the whole monorepo (see Dockerfile.dockerignore).
COPY Cargo.toml Cargo.lock ./
COPY crates ./crates
COPY apps/assembler ./apps/assembler
# Point the cxx bridges at the static OCCT + Debian/apt layout (see build.rs).
ENV OCCT_PREFIX=/opt/occt \
    FCL_PREFIX=/usr LIBCCD_PREFIX=/usr EIGEN_PREFIX=/usr OCTOMAP_PREFIX=/usr
# Cache mounts: the cargo registry and the target dir survive across builds,
# so a code-only change relinks instead of recompiling every dependency.
# The binary is copied out because cache mounts vanish after the RUN.
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/app/target \
    cargo build --release -p assembler \
    && cp target/release/assembler /usr/local/bin/assembler \
    && strip /usr/local/bin/assembler

# ---- runtime ----
# OCCT is inside the binary; only the FCL collision stack is dynamic. Exact
# runtime .so packages (no -dev headers/toolchain), non-root user, healthcheck
# against the service's own /health.
FROM debian:bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends \
      libfcl0.7 libccd2 liboctomap1.9 libopenblas0-pthread \
      curl ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 1001 --create-home assembler
COPY --from=build /usr/local/bin/assembler /usr/local/bin/assembler
USER assembler
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8000/health || exit 1
CMD ["assembler"]
