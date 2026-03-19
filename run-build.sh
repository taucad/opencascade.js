#!/bin/bash
set -euo pipefail

source /Users/rifont/git/tau/repos/assimpjs/emsdk/emsdk_env.sh 2>/dev/null

export THREADING="single-threaded"
export OCJS_OPT="-O3"
export OCJS_LTO=0
export OCJS_EXCEPTIONS=1
export OCJS_WASM_OPT_LEVEL="-O3"
export OCJS_DEFINES="OCCT_NO_DUMP"
export OCJS_UNDEFINES="OCC_CONVERT_SIGNALS"

cd /Users/rifont/git/tau/repos/opencascade.js

./build-wasm.sh full \
  ../../repos/replicad/packages/replicad-opencascadejs/build-config/custom_build_with_exceptions_v8.yml
