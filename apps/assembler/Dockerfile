# Carbon assembler service (Rust): STEP -> GLB + assembly graph, and
# collision-free disassembly motion planning. Multi-stage build.
#
# OCCT is built from source at V8_0_0_p1 with:
#   - USE_MMGR_TYPE=JEMALLOC  (Standard::Allocate global mutex -> jemalloc arenas)
#   - the CommonBaseAllocator thread_local patch (occt-patches/)
# Together these lift in-process STEP-convert scaling from ~3.5x to near-linear
# on many cores (see the patch header). FCL 0.7.0 comes from apt (bookworm ships
# exactly 0.7.0). The runtime stage carries only the shared libs + the binary.
#
# Build from the REPO ROOT (the cargo workspace spans crates/* + apps/assembler):
#   docker build -f apps/assembler/Dockerfile -t carbon-assembler .
#
# NOTE: the OCCT source build is ~20-40 min. A CI cache of the /opt/occt install
# (or a prebuilt OCCT base image) makes rebuilds minutes.

# ---- OCCT 8.0.0_p1 builder (jemalloc + thread_local patch) ----
FROM debian:bookworm-slim AS occt
RUN apt-get update && apt-get install -y --no-install-recommends \
      git cmake g++ make ca-certificates perl \
      libjemalloc-dev libfreetype-dev rapidjson-dev zlib1g-dev \
    && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 --branch V8_0_0_p1 https://github.com/Open-Cascade-SAS/OCCT.git /src
COPY apps/assembler/occt-patches /occt-patches
RUN /occt-patches/apply.sh /src
WORKDIR /src/build
RUN cmake .. \
      -DCMAKE_BUILD_TYPE=Release \
      -DCMAKE_INSTALL_PREFIX=/opt/occt \
      -DUSE_MMGR_TYPE=JEMALLOC \
      -DBUILD_MODULE_Draw=OFF \
      -DBUILD_MODULE_Visualization=OFF \
      -DBUILD_MODULE_ApplicationFramework=ON \
      -DBUILD_MODULE_DataExchange=ON \
      -DBUILD_MODULE_ModelingAlgorithms=ON \
      -DBUILD_MODULE_ModelingData=ON \
      -DUSE_FREETYPE=OFF -DUSE_TK=OFF -DUSE_RAPIDJSON=OFF -DUSE_OPENGL=OFF \
    && make -j"$(nproc)" && make install

# ---- Rust builder ----
FROM rust:1.90-bookworm AS build
RUN apt-get update && apt-get install -y --no-install-recommends \
      libfcl-dev libccd-dev libeigen3-dev liboctomap-dev libjemalloc-dev libfreetype6 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=occt /opt/occt /opt/occt
WORKDIR /app
# Only the Rust workspace — not the whole monorepo (see .dockerignore).
COPY Cargo.toml Cargo.lock ./
COPY crates ./crates
COPY apps/assembler ./apps/assembler
# Point the cxx bridges at the built-OCCT + Debian/apt layout (see build.rs).
ENV OCCT_PREFIX=/opt/occt \
    FCL_PREFIX=/usr LIBCCD_PREFIX=/usr EIGEN_PREFIX=/usr OCTOMAP_PREFIX=/usr
RUN cargo build --release -p assembler

# ---- runtime ----
FROM debian:bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends \
      libfcl-dev libccd-dev liboctomap-dev libjemalloc2 libfreetype6 libfontconfig1 \
      zlib1g libtbb12 ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=occt /opt/occt/lib /opt/occt/lib
COPY --from=build /app/target/release/assembler /usr/local/bin/assembler
ENV LD_LIBRARY_PATH=/opt/occt/lib
EXPOSE 8000
CMD ["assembler"]
