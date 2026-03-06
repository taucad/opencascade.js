# opencascade.js — OCCT V8 WASM build image
#
# Build:
#   docker build -t opencascade-js .
#
# Run (default full build with balanced preset):
#   docker run -v $(pwd)/output:/output opencascade-js full build-configs/full.yml
#
# Run with custom config:
#   docker run -v $(pwd)/my-config.yml:/opencascade.js/build-configs/custom.yml \
#     -v $(pwd)/output:/output \
#     opencascade-js full build-configs/custom.yml
#
# Environment variable overrides:
#   docker run -e OCJS_OPT="-Os" -e OCJS_EXCEPTIONS=1 ... opencascade-js full build-configs/full.yml

FROM emscripten/emsdk:5.0.1@sha256:c89732ef63a56de5a96395c5a8c1c7904f7420131a045406e6fedc4cbe1cc198 AS base-image

RUN \
  apt-get update -y && \
  apt-get install -y --no-install-recommends \
    bash \
    build-essential \
    cmake \
    curl \
    git \
    python3 \
    python3-pip \
    python3-setuptools && \
  rm -rf /var/lib/apt/lists/*

COPY requirements.txt /tmp/requirements.txt
RUN pip install --break-system-packages -r /tmp/requirements.txt && rm /tmp/requirements.txt

# Clone dependencies at pinned commits (from DEPS.json)
WORKDIR /rapidjson/
RUN \
  git clone https://github.com/Tencent/rapidjson.git . && \
  git checkout 24b5e7a8b27f42fa16b96fc70aade9106cf7102f

WORKDIR /freetype/
RUN \
  git clone https://github.com/freetype/freetype.git . && \
  git checkout de8b92dd7ec634e9e2b25ef534c54a3537555c11

WORKDIR /occt/
RUN \
  git clone https://github.com/Open-Cascade-SAS/OCCT.git . && \
  git checkout 48ebca0f70a5e4b936548b695bc3583363898da4

# Copy the build system
WORKDIR /opencascade.js/
COPY src ./src
COPY build-configs ./build-configs
COPY build-wasm.sh ./build-wasm.sh
COPY DEPS.json ./DEPS.json
RUN chmod +x build-wasm.sh

# Set default environment
ENV OCCT_ROOT=/occt
ENV RAPIDJSON_ROOT=/rapidjson
ENV FREETYPE_ROOT=/freetype
ENV THREADING=single-threaded
ENV OCJS_OPT=-O2
ENV OCJS_LTO=0
ENV OCJS_EXCEPTIONS=0

RUN mkdir -p build/bindings build/sources build/dist /output

# Apply patches and generate bindings (shared across all builds)
RUN python3 src/applyPatches.py && \
    python3 -c "\
import sys; sys.path.insert(0, 'src'); \
from Common import buildFlatIncludes, buildPch; \
buildFlatIncludes(); \
buildPch(threading='single-threaded')" && \
    python3 -m ocjs_bindgen --config bindgen-filters.yaml

ENTRYPOINT ["/opencascade.js/build-wasm.sh"]
CMD ["full", "build-configs/full.yml"]
