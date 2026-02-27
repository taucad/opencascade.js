FROM emscripten/emsdk:3.1.14 AS base-image

RUN \
  apt update -y && \
  apt install -y \
  bash \
  build-essential \
  cmake \
  curl \
  git \
  libffi-dev \
  libgdbm-dev \
  libncurses5-dev \
  libnss3-dev \
  libreadline-dev \
  libsqlite3-dev \
  libssl-dev \
  libbz2-dev \
  npm \
  python3 \
  python3-pip \
  python3-setuptools \
  zlib1g-dev

RUN \
  pip install \
  libclang==15.0.6.1 \
  pyyaml==6.0 \
  cerberus==1.3.4 \
  argparse==1.4.0

WORKDIR /rapidjson/
RUN \
  git clone -b v1.1.0 https://github.com/Tencent/rapidjson.git . 

WORKDIR /freetype/
RUN \
  git clone -b VER-2-13-0 https://github.com/freetype/freetype.git .

ENV OCCT_TAG=V7_6_2
WORKDIR /occt/
RUN \
  curl -L "https://github.com/Open-Cascade-SAS/OCCT/archive/refs/tags/${OCCT_TAG}.tar.gz" -o occt.tar.gz && \
  tar -xzf occt.tar.gz && \
  OCCT_DIR=$(ls -d OCCT-*) && \
  mv ${OCCT_DIR}/* . && \
  (mv ${OCCT_DIR}/.* . || true) && \
  rm -rf ${OCCT_DIR} occt.tar.gz

WORKDIR /opencascade.js/
COPY src ./src
WORKDIR /src/

ARG threading=single-threaded
ENV threading=${threading}

FROM base-image AS test-image

RUN \
  mkdir /opencascade.js/build/ && \
  mkdir /opencascade.js/dist/ && \
  /opencascade.js/src/applyPatches.py

ENTRYPOINT ["/opencascade.js/src/buildFromYaml.py"]

FROM test-image AS custom-build-image

RUN \
  /opencascade.js/src/generateBindings.py && \
  /opencascade.js/src/compileBindings.py ${threading} && \
  /opencascade.js/src/compileSources.py ${threading} && \
  chmod -R 777 /opencascade.js/ && \
  chmod -R 777 /occt

ENTRYPOINT ["/opencascade.js/src/buildFromYaml.py"]
