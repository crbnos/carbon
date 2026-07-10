# Carbon geometry service (Rust). Multi-stage: build OpenCASCADE 7.9.3 from
# source (Debian ships 7.6.3; nodeId parity requires the SAME 7.9.3 the Python
# service used), FCL 0.7.0 from apt (bookworm ships exactly 0.7.0), then the
# Rust binary. Runtime stage carries only the shared libs + the static-ish binary.
#
# NOTE: the OCCT source build is ~20-40 min. Kept correct over fast; a CI cache
# of the /opt/occt install (or a prebuilt OCCT base image) makes rebuilds minutes.

# ---- OCCT 7.9.3 builder ----
FROM debian:bookworm-slim AS occt
RUN apt-get update && apt-get install -y --no-install-recommends \
      git cmake g++ make ca-certificates \
      libfreetype-dev tcl-dev tk-dev libx11-dev libgl-dev rapidjson-dev zlib1g-dev \
    && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 --branch V7_9_3 https://github.com/Open-Cascade-SAS/OCCT.git /src
WORKDIR /src/build
RUN cmake .. \
      -DCMAKE_BUILD_TYPE=Release \
      -DCMAKE_INSTALL_PREFIX=/opt/occt \
      -DBUILD_MODULE_Draw=OFF \
      -DBUILD_MODULE_Visualization=OFF \
      -DBUILD_MODULE_ApplicationFramework=ON \
      -DBUILD_MODULE_DataExchange=ON \
      -DBUILD_MODULE_ModelingAlgorithms=ON \
      -DBUILD_MODULE_ModelingData=ON \
      -DUSE_FREETYPE=ON \
    && make -j"$(nproc)" && make install

# ---- Rust builder ----
FROM rust:1.90-bookworm AS build
RUN apt-get update && apt-get install -y --no-install-recommends \
      libfcl-dev libccd-dev libeigen3-dev liboctomap-dev libfreetype6 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=occt /opt/occt /opt/occt
WORKDIR /app
COPY . .
# Point the cxx bridges at the Debian/apt + built-OCCT layout (see build.rs).
ENV OCCT_PREFIX=/opt/occt \
    FCL_PREFIX=/usr LIBCCD_PREFIX=/usr EIGEN_PREFIX=/usr OCTOMAP_PREFIX=/usr
RUN cargo build --release -p server

# ---- runtime ----
# Reuse the same apt packages the build stage linked against (their runtime .so
# come with the -dev packages, whose names are known-good on bookworm) rather
# than guessing runtime package names.
FROM debian:bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends \
      libfcl-dev libccd-dev liboctomap-dev libfreetype6 libfontconfig1 zlib1g libtbb12 \
      libx11-6 libxext6 libgl1 ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=occt /opt/occt/lib /opt/occt/lib
COPY --from=build /app/target/release/carbon-geometry /usr/local/bin/carbon-geometry
ENV LD_LIBRARY_PATH=/opt/occt/lib
EXPOSE 8000
CMD ["carbon-geometry"]
