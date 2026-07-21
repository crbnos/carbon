# syntax=docker/dockerfile:1.7
# Carbon assembler service (Rust): STEP -> GLB + assembly graph, and
# collision-free disassembly motion planning.
#
# OCCT is STATIC-LINKED into the binary from the prebuilt carbon-occt base
# image (OCCT V8_0_0_p1 + the CommonBaseAllocator thread_local patch — see
# occt.Dockerfile). Build that base ONCE and keep it:
#   docker build -f apps/assembler/occt.Dockerfile -t carbon-occt:8.0.0-p1 apps/assembler
# Then this image builds in ~minutes (cargo cache mounts make code-only
# rebuilds seconds), and the runtime stage is a slim image with just the
# stripped binary — OCCT and FCL/ccd are static-linked in, so no collision or
# OCCT shared objects and no X11; only OpenBLAS + the C++/Fortran runtimes.
#
# Build from the REPO ROOT (the cargo workspace spans crates/* + apps/assembler):
#   docker build -f apps/assembler/Dockerfile -t carbon-assembler .
# Override the base tag with --build-arg OCCT_IMAGE=<registry>/carbon-occt:TAG.

ARG OCCT_IMAGE=carbon-occt:8.0.0-p1

# ---- prebuilt static OCCT (kept base image; no source compile) ----
FROM ${OCCT_IMAGE} AS occt

# ---- static FCL + libccd (built from source; Debian ships only .so) ----
# The collision shim uses BVH mesh collision only — no octree — so FCL is built
# minimal (FCL_WITH_OCTOMAP=OFF) and STATIC, so it links into the binary and the
# runtime image carries no fcl/ccd/octomap shared objects. Fast (~minutes) and
# Docker-layer cached; only rebuilt when the pinned versions below change.
FROM debian:bookworm-slim AS fcl
# SIMD baseline for the compiled GJK/EPA bits (the templated hot path is compiled
# in the collision shim instead). Auto-derived from the build platform (buildx sets
# TARGETARCH): x86-64-v3 (AVX2+FMA, the x86_64 Fargate fleet) for amd64, armv8.2-a
# (Lambda Graviton2 / Neoverse-N1 baseline) for arm64. Override with
# --build-arg MARCH=<value>.
ARG TARGETARCH
ARG MARCH
RUN apt-get update && apt-get install -y --no-install-recommends \
      git cmake ninja-build g++ libeigen3-dev ca-certificates \
    && rm -rf /var/lib/apt/lists/*
# libccd — double precision (FCL requires it), static.
RUN MARCH="${MARCH:-$( [ "$TARGETARCH" = arm64 ] && echo armv8.2-a || echo x86-64-v3 )}" \
    && git clone --depth 1 --branch v2.1 https://github.com/danfis/libccd.git /ccd \
    && cmake -S /ccd -B /ccd/b -G Ninja -DCMAKE_BUILD_TYPE=Release \
        -DCMAKE_INSTALL_PREFIX=/opt/fcl -DCMAKE_POSITION_INDEPENDENT_CODE=ON \
        -DCMAKE_CXX_FLAGS_RELEASE="-O3 -march=${MARCH}" \
        -DBUILD_SHARED_LIBS=OFF -DENABLE_DOUBLE_PRECISION=ON \
    && cmake --build /ccd/b --target install
# FCL 0.7.0 — static, no octomap; finds ccd + Eigen under the same prefix.
# FCL ignores BUILD_SHARED_LIBS; its own FCL_STATIC_LIBRARY flag is what selects
# a static archive (verified: without it FCL builds libfcl.so regardless).
RUN MARCH="${MARCH:-$( [ "$TARGETARCH" = arm64 ] && echo armv8.2-a || echo x86-64-v3 )}" \
    && git clone --depth 1 --branch 0.7.0 https://github.com/flexible-collision-library/fcl.git /fcl \
    && cmake -S /fcl -B /fcl/b -G Ninja -DCMAKE_BUILD_TYPE=Release \
        -DCMAKE_INSTALL_PREFIX=/opt/fcl -DCMAKE_PREFIX_PATH=/opt/fcl \
        -DCMAKE_POSITION_INDEPENDENT_CODE=ON \
        -DCMAKE_CXX_FLAGS_RELEASE="-O3 -march=${MARCH}" \
        -DCMAKE_CXX_STANDARD=17 -DCMAKE_CXX_STANDARD_REQUIRED=ON \
        -DFCL_STATIC_LIBRARY=ON -DFCL_WITH_OCTOMAP=OFF -DFCL_BUILD_TESTS=OFF \
    && cmake --build /fcl/b --target install

# ---- static Draco (built from source; Debian/brew ship only shared) ----
# KHR_draco_mesh_compression encoder for the optimise pipeline. Encoder-only
# (transcoder off — we build the glTF ourselves in Rust), STATIC, so libdraco.a
# links into the binary and the runtime image carries no draco .so. Draco vendors
# its own deps, so no extra -dev packages. Docker-layer cached; rebuilt only when
# the pinned version below changes.
FROM debian:bookworm-slim AS draco
ARG TARGETARCH
ARG MARCH
RUN apt-get update && apt-get install -y --no-install-recommends \
      git cmake ninja-build g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN MARCH="${MARCH:-$( [ "$TARGETARCH" = arm64 ] && echo armv8.2-a || echo x86-64-v3 )}" \
    && git clone --depth 1 --branch 1.5.7 https://github.com/google/draco.git /draco \
    && cmake -S /draco -B /draco/b -G Ninja -DCMAKE_BUILD_TYPE=Release \
        -DCMAKE_INSTALL_PREFIX=/opt/draco -DCMAKE_POSITION_INDEPENDENT_CODE=ON \
        -DCMAKE_CXX_FLAGS_RELEASE="-O3 -march=${MARCH}" \
        -DBUILD_SHARED_LIBS=OFF -DDRACO_TRANSCODER_SUPPORTED=OFF \
    && cmake --build /draco/b --target install

# ---- Rust builder ----
FROM rust:1.90-bookworm AS build
# Eigen headers for the cxx shim; OpenBLAS/gfortran for the planner's BLAS.
# FCL/ccd come from the static build above (no libfcl-dev/libccd-dev).
RUN apt-get update && apt-get install -y --no-install-recommends \
      libeigen3-dev libopenblas-dev gfortran \
    && rm -rf /var/lib/apt/lists/*
COPY --from=occt /opt/occt /opt/occt
COPY --from=fcl /opt/fcl /opt/fcl
COPY --from=draco /opt/draco /opt/draco
WORKDIR /app
# Only the Rust workspace — not the whole monorepo (see Dockerfile.dockerignore).
COPY Cargo.toml Cargo.lock ./
COPY crates ./crates
COPY apps/assembler ./apps/assembler
# Point the cxx bridges at the static OCCT + static FCL/ccd (build.rs picks
# `static=` when it finds a .a at the prefix). Eigen headers from apt.
#
# Tune the Rust codegen per target: x86-64-v3 (AVX2/FMA) for the x86_64 Fargate
# fleet, neoverse-n1 for arm64 (Lambda Graviton2) — so the planner's collision-heavy
# loops and the Eigen/FCL math vectorize, matching the C++ -march above
# (crates/collision/build.rs). Conservative baselines, NOT target-cpu=native (which
# bakes the build box's ISA and SIGILLs on older CPUs). Both are target-triple
# scoped, so only the one matching the build arch applies — the other is inert.
# Lives here (not .cargo/config.toml, which isn't copied into this build context
# anyway) so it actually applies to the deploy target.
ENV OCCT_PREFIX=/opt/occt OCCT_LINK=static \
    FCL_PREFIX=/opt/fcl LIBCCD_PREFIX=/opt/fcl EIGEN_PREFIX=/usr OCTOMAP_PREFIX=/usr \
    DRACO_PREFIX=/opt/draco \
    CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_RUSTFLAGS="-C target-cpu=x86-64-v3" \
    CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_RUSTFLAGS="-C target-cpu=neoverse-n1"
# Cache mounts: the cargo registry and the target dir survive across builds,
# so a code-only change relinks instead of recompiling every dependency.
# The binary is copied out because cache mounts vanish after the RUN.
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/app/target \
    cargo build --release -p assembler \
    && cp target/release/assembler /usr/local/bin/assembler \
    && strip /usr/local/bin/assembler

# ---- runtime ----
# OCCT and FCL/ccd are inside the binary; the only dynamic native deps left are
# OpenBLAS (planner linear algebra) + the C++/Fortran runtimes. No -dev headers
# or toolchain, non-root user, healthcheck against the service's own /health.
FROM debian:bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends \
      libopenblas0-pthread libgfortran5 libstdc++6 \
      curl ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 1001 --create-home assembler
COPY --from=build /usr/local/bin/assembler /usr/local/bin/assembler
# AWS Lambda Web Adapter — proxies a Lambda invoke to the HTTP server so the same
# image runs unchanged on Lambda (default), and is inert on ECS/EC2/local. Point
# it at our port (LWA defaults to 8080). Pin: verify against the latest release.
COPY --from=public.ecr.aws/awsguru/aws-lambda-adapter:0.9.1 /lambda-adapter /opt/extensions/lambda-adapter
# Both the app and the Lambda Web Adapter read PORT (LWA falls back to it).
ENV PORT=8000
# Non-HTTP (Event) invokes — the self-dispatch worker path — are POSTed by the
# adapter to this app route instead of being translated as HTTP requests.
ENV AWS_LWA_PASS_THROUGH_PATH=/events
USER assembler
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8000/health || exit 1
CMD ["assembler"]
