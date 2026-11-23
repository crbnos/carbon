# Prebuilt STATIC OCCT base image for the assembler service. Built ONCE and
# kept (OCCT + the patch change ~never); the app Dockerfile FROMs this so
# per-code rebuilds skip the ~30-min OCCT compile entirely.
#
# Carbon's CI publishes it to public.ecr.aws/b8l5b8t9/carbon/occt, tagged with
# a hash of this file + occt-patches/ (.github/scripts/build-images.sh), and the
# app Dockerfile uses that image by default. Build it yourself only to change it:
#   docker build -f apps/assembler/occt.Dockerfile -t carbon-occt:8.0.0-p1 apps/assembler
#
# OCCT V8_0_0_p1 + the CommonBaseAllocator thread_local patch (occt-patches/) —
# THE lever that lifts in-process STEP-convert scaling from ~3.5x to near-linear
# on many cores. Built STATIC with everything visual/scripting disabled
# (USE_XLIB/FREETYPE/OPENGL/TK/TCL off — no X11/fontconfig deps at all, the
# opencascade-rs recipe), so the app binary links OCCT in and ships
# self-contained. Build context is apps/assembler (for occt-patches/).
FROM debian:bookworm-slim AS occt
RUN apt-get update && apt-get install -y --no-install-recommends \
      git cmake g++ make ninja-build ca-certificates perl \
    && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 --branch V8_0_0_p1 https://github.com/Open-Cascade-SAS/OCCT.git /src
COPY occt-patches /occt-patches
RUN /occt-patches/apply.sh /src
WORKDIR /src/build
RUN cmake -G Ninja .. \
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
    && ninja && ninja install

# Minimal image that just carries /opt/occt so the app Dockerfile can COPY it.
FROM debian:bookworm-slim
COPY --from=occt /opt/occt /opt/occt
