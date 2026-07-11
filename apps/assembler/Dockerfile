# Carbon assembler service (Rust): STEP -> GLB + assembly graph, and
# collision-free disassembly motion planning.
#
# OCCT is STATIC-LINKED into the binary from the prebuilt carbon-occt base
# image (OCCT V8_0_0_p1 + the CommonBaseAllocator thread_local patch — see
# occt.Dockerfile). Build that base ONCE and keep it:
#   docker build -f apps/assembler/occt.Dockerfile -t carbon-occt:8.0.0-p1 apps/assembler
# Then this image builds in ~minutes, and the runtime stage is just the binary
# plus the FCL collision libs — no OCCT shared objects, no X11/fontconfig.
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
RUN cargo build --release -p assembler

# ---- runtime ----
# OCCT is inside the binary; only the dynamically-linked FCL stack remains.
# The -dev packages are used because their runtime .so names are known-good on
# bookworm (they pull the actual runtime libs; a few MB of headers ride along).
FROM debian:bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends \
      libfcl-dev libccd-dev liboctomap-dev libopenblas-dev ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/target/release/assembler /usr/local/bin/assembler
EXPOSE 8000
CMD ["assembler"]
