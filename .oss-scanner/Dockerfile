# Build image for Anthropic's OSS Scanner (https://github.com/anthropics/oss-scanner).
# The scanner builds this with the repository as context, then audits /src with no
# network, so everything the tests need is fetched here.
#
# It covers both workspaces: the TypeScript monorepo (apps/erp, apps/mes,
# packages/*) and the Rust workspace (crates/*, apps/assembler). The Rust crates
# link OpenCASCADE, FCL and Draco, built below from the same pinned sources as
# apps/assembler/Dockerfile and occt.Dockerfile; keep the versions in step. Those
# stages build in parallel with the JavaScript install, which keeps the whole
# build inside the scanner's 45-minute limit.

# ---- Shared toolchain ----
# The Node image already has git, g++, make and perl. Every native build and the
# final image start here, so the package mirror is hit once, not once per stage:
# four parallel toolchain installs from a slow mirror took 25 minutes on their own.
FROM node:24.22.1-bookworm AS toolchain
RUN apt-get update && apt-get install -y --no-install-recommends \
      cmake ninja-build libeigen3-dev libopenblas-dev gfortran \
    && rm -rf /var/lib/apt/lists/*

# ---- OpenCASCADE, static (as apps/assembler/occt.Dockerfile) ----
FROM toolchain AS occt
RUN git clone --depth 1 --branch V8_0_0_p1 https://github.com/Open-Cascade-SAS/OCCT.git /occt
COPY apps/assembler/occt-patches /occt-patches
RUN /occt-patches/apply.sh /occt
RUN cmake -S /occt -B /occt/build -G Ninja \
      -DCMAKE_BUILD_TYPE=Release \
      -DCMAKE_INSTALL_PREFIX=/opt/occt \
      -DBUILD_LIBRARY_TYPE=Static \
      -DBUILD_MODULE_Draw=OFF \
      -DBUILD_MODULE_Visualization=OFF \
      -DBUILD_MODULE_ApplicationFramework=ON \
      -DBUILD_MODULE_DataExchange=ON \
      -DBUILD_MODULE_ModelingAlgorithms=ON \
      -DBUILD_MODULE_ModelingData=ON \
      -DBUILD_MODULE_FoundationClasses=ON \
      -DUSE_FREETYPE=OFF -DUSE_XLIB=OFF -DUSE_TK=OFF -DUSE_TCL=OFF \
      -DUSE_OPENGL=OFF -DUSE_GLES2=OFF -DUSE_RAPIDJSON=OFF -DUSE_TBB=OFF \
      -DUSE_FREEIMAGE=OFF -DUSE_DRACO=OFF -DUSE_VTK=OFF -DUSE_FFMPEG=OFF \
    && cmake --build /occt/build --target install

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
# both server apps. The ERP build also generates the MCP tool manifest.
RUN corepack enable && pnpm --version
RUN pnpm install --frozen-lockfile
RUN pnpm run build:erp && pnpm run build:mes

# Rust: the native libraries arrive here, after the JavaScript steps, so their
# stages compile alongside them. A dev build keeps debug info for the auditor.
COPY --from=rust /usr/local/rustup /usr/local/rustup
COPY --from=rust /usr/local/cargo /usr/local/cargo
COPY --from=occt /opt/occt /opt/occt
COPY --from=fcl /opt/fcl /opt/fcl
COPY --from=draco /opt/draco /opt/draco
RUN cargo fetch --locked && cargo build --workspace --all-targets --locked

# Tests run offline. A failure is reported, never fatal.
RUN timeout 1200 pnpm run test || echo "WARNING: unit tests reported failures"
RUN timeout 900 cargo test --workspace --locked --offline || echo "WARNING: cargo tests reported failures"
