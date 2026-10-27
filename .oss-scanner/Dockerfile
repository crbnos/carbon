# Build image for Anthropic's OSS Scanner (https://github.com/anthropics/oss-scanner).
# The scanner builds this with the repository as context, then audits /src with no
# network, so everything the tests need is fetched here.
#
# It covers both workspaces: the TypeScript monorepo (apps/erp, apps/mes,
# packages/*) and the Rust workspace (crates/*, apps/assembler). The Rust crates
# link OpenCASCADE (our published production image, below), and FCL and Draco,
# built from the same pinned sources as apps/assembler/Dockerfile; keep the
# versions in step. Those stages build in parallel with the JavaScript steps.

# ---- Shared toolchain ----
# The Node image already has git, g++, make and perl. Every native build and the
# final image start here, so the package mirror is hit once, not once per stage:
# four parallel toolchain installs from a slow mirror took 25 minutes on their own.
FROM node:24.22.1-bookworm AS toolchain
RUN apt-get update && apt-get install -y --no-install-recommends \
      cmake ninja-build libeigen3-dev libopenblas-dev gfortran \
    && rm -rf /var/lib/apt/lists/*

# ---- OpenCASCADE, static ----
# The exact build the assembler links in production: build-images.yml publishes
# apps/assembler/occt.Dockerfile to public ECR, tagged with a hash of that file and
# occt-patches/ (.github/scripts/build-images.sh). Compiling it here took 31
# minutes on a 4-core runner, most of the scanner's 45. The image is linux/amd64
# only, like the scanner. When occt.Dockerfile or its patches change, move this
# tag to the new hash.
FROM public.ecr.aws/b8l5b8t9/carbon/occt:e0ef0c3bcf62 AS occt

# ---- FCL + libccd, static (as apps/assembler/Dockerfile) ----
FROM toolchain AS fcl
RUN git clone --depth 1 --branch v2.1 https://github.com/danfis/libccd.git /ccd \
    && cmake -S /ccd -B /ccd/b -G Ninja -DCMAKE_BUILD_TYPE=Release \
        -DCMAKE_INSTALL_PREFIX=/opt/fcl -DCMAKE_POSITION_INDEPENDENT_CODE=ON \
        -DBUILD_SHARED_LIBS=OFF -DENABLE_DOUBLE_PRECISION=ON \
    && cmake --build /ccd/b --target install
RUN git clone --depth 1 --branch 0.7.0 https://github.com/flexible-collision-library/fcl.git /fcl \
    && cmake -S /fcl -B /fcl/b -G Ninja -DCMAKE_BUILD_TYPE=Release \
        -DCMAKE_INSTALL_PREFIX=/opt/fcl -DCMAKE_PREFIX_PATH=/opt/fcl \
        -DCMAKE_POSITION_INDEPENDENT_CODE=ON \
        -DCMAKE_CXX_STANDARD=17 -DCMAKE_CXX_STANDARD_REQUIRED=ON \
        -DFCL_STATIC_LIBRARY=ON -DFCL_WITH_OCTOMAP=OFF -DFCL_BUILD_TESTS=OFF \
    && cmake --build /fcl/b --target install

# ---- Draco encoder, static (as apps/assembler/Dockerfile) ----
FROM toolchain AS draco
RUN git clone --depth 1 --branch 1.5.7 https://github.com/google/draco.git /draco \
    && cmake -S /draco -B /draco/b -G Ninja -DCMAKE_BUILD_TYPE=Release \
        -DCMAKE_INSTALL_PREFIX=/opt/draco -DCMAKE_POSITION_INDEPENDENT_CODE=ON \
        -DBUILD_SHARED_LIBS=OFF -DDRACO_TRANSCODER_SUPPORTED=OFF \
    && cmake --build /draco/b --target install

# ---- Rust toolchain (the assembler's builder image) ----
FROM rust:1.99-bookworm AS rust

# ---- The image the scanner audits ----
# Eigen (collision shim), OpenBLAS and gfortran (planner) come from the toolchain.
FROM toolchain

ENV CI=1 \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    NODE_OPTIONS=--max-old-space-size=8024 \
    RUSTUP_HOME=/usr/local/rustup \
    CARGO_HOME=/usr/local/cargo \
    PATH=/usr/local/cargo/bin:$PATH \
    OCCT_PREFIX=/opt/occt OCCT_LINK=static \
    FCL_PREFIX=/opt/fcl LIBCCD_PREFIX=/opt/fcl EIGEN_PREFIX=/usr OCTOMAP_PREFIX=/usr \
    DRACO_PREFIX=/opt/draco

COPY . /src
WORKDIR /src

# TypeScript: the same install the production image runs (see /Dockerfile), then
# both server apps (the ERP build also generates the MCP tool manifest), then the
# unit tests. All of it, and the Rust dependency download, runs while the native
# stages compile: OpenCASCADE is the longest step on a small machine.
RUN corepack enable && pnpm --version
RUN pnpm install --frozen-lockfile
RUN pnpm run build:erp && pnpm run build:mes
# Tests run offline. A failure is reported, never fatal.
RUN timeout 1200 pnpm run test || echo "WARNING: unit tests reported failures"
COPY --from=rust /usr/local/rustup /usr/local/rustup
COPY --from=rust /usr/local/cargo /usr/local/cargo
RUN cargo fetch --locked

# Rust: the native libraries arrive here. A dev build keeps debug info for the auditor.
COPY --from=occt /opt/occt /opt/occt
COPY --from=fcl /opt/fcl /opt/fcl
COPY --from=draco /opt/draco /opt/draco
RUN cargo build --workspace --all-targets --locked --offline
RUN timeout 900 cargo test --workspace --locked --offline || echo "WARNING: cargo tests reported failures"
