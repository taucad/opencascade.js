#!/usr/bin/env bash
# docker-entrypoint.sh — dispatch container subcommands through Nx so consumers
# get content-addressed caching across `docker run` invocations.
#
# Recognised forms:
#   full <yaml>         -> nx run ocjs:link (Nx graph pulls every transitive dep)
#   link <yaml>         -> nx run ocjs:link
#   compile-bindings    -> nx run ocjs:compile-bindings
#   compile-sources     -> nx run ocjs:compile-sources
#   pch                 -> nx run ocjs:pch
#   generate            -> nx run ocjs:generate
#   apply-patches       -> nx run ocjs:apply-patches
#   validate <yaml>     -> build-wasm.sh validate <yaml>   (no Nx caching needed)
#   nx <args...>        -> npx nx <args...>                (escape hatch)
#   --help|-h           -> show this help
#
# Everything else falls through to build-wasm.sh for backwards compatibility.
#
# OCJS_YAML is set from the YAML positional argument so the Nx `link` target
# (whose cache key depends on OCJS_YAML + a sha of the file contents) can hash
# correctly. OCJS_OUTPUT_DIR is honoured if the caller exported it, otherwise
# it defaults to the image-level /output.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OCJS_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# print_output_mount_receipt
# --------------------------
# Read `/proc/self/mountinfo` for `${OCJS_OUTPUT_DIR:-/output}` and tell the
# user, in plain language, whether outputs will reach their host filesystem.
#
# The container runtime (Colima, Docker Desktop, Rancher Desktop, Lima,
# OrbStack) runs Linux inside a VM on macOS/Windows. Only the user's home
# directory is shared into that VM by default; folders like /tmp, /var,
# /opt, /private are VM-local. A `docker run -v /tmp/foo:/output ...` looks
# fine from inside the container but actually writes to the VM's tmpfs,
# not the host. The container cannot see across the VM boundary, but the
# filesystem type recorded in /proc/self/mountinfo is a reliable proxy:
#
#   host-shared:     virtiofs, 9p, fuse.osxfs, nfs, cifs, smbfs
#   native Linux:    ext4, xfs, btrfs, zfs   (also a real disk on the host)
#   VM-local:        overlay, tmpfs, aufs    (the footgun)
#
# Three outcomes:
#   1. Host-shared / native:  one-line receipt on stdout.
#   2. VM-local:              multi-line warning on stderr (recovery cmd + fix).
#   3. No mount at all:       multi-line warning on stderr (user forgot -v).
#
# Never blocks the build. CI users running with intentional tmpfs outputs
# see the warning once and can ignore it.
print_output_mount_receipt() {
  local target="${OCJS_OUTPUT_DIR:-/output}"
  [ -d "$target" ] || return 0

  # mountinfo format (man 5 proc):
  #   id parent maj:min root mount_point opts [optional...] " - " fstype source super_opts
  #
  # We extract:
  #   - root        (field 4, pre-dash): the path *inside the source filesystem*
  #                 that the user actually bind-mounted. For virtiofs/9p shares
  #                 this is the host-share-relative directory (e.g. `/git/tau/out`);
  #                 for an ext4 bind-mount it's the VM-local path (e.g. `/tmp/probe`).
  #                 This is what the user typed in `docker run -v <source>:/output`
  #                 modulo the host-share rewrite, so it's the most legible thing
  #                 to echo back to them.
  #   - fstype      (post-dash, word 1): filesystem driver name.
  #
  # The post-dash `source` field is the kernel-visible source string (`mount0`
  # for virtiofs, `/dev/root` for an ext4 disk) and is not user-friendly, so we
  # avoid surfacing it.
  local line root post fstype
  line=$(awk -v t="$target" '$5 == t {print; exit}' /proc/self/mountinfo 2>/dev/null || true)

  if [ -z "$line" ]; then
    cat >&2 <<NOMOUNT

========================================================================
  WARNING: you did not connect an output folder with -v.
========================================================================
  Build outputs will be written inside this container and lost when
  the container exits.

  Re-run with an output folder under your home directory:

      mkdir -p out
      docker run ... -v "\$(pwd)/out:${target}" ... <command> <yaml>

========================================================================

NOMOUNT
    return 0
  fi

  root=$(echo "$line" | awk -F' - ' '{print $1}' | awk '{print $4}')
  post=$(echo "$line" | awk -F' - ' '{print $2}')
  fstype=$(echo "$post" | awk '{print $1}')

  # Detect Docker Desktop / Colima / Rancher Desktop / Lima / WSL.
  # On those runtimes, the Linux kernel runs inside a VM on macOS/Windows
  # and shares the user's home directory via virtiofs/9p/fuse.osxfs/nfs.
  # Any ext4/xfs/btrfs/zfs mount inside the container is then the VM's own
  # disk, which the host filesystem cannot see -- the classic "/tmp footgun".
  #
  # Detection signals (any one is sufficient):
  #   - kernel release tag (linuxkit/lima/colima/microsoft/WSL)
  #   - DMI product/vendor name reports a hypervisor (Apple Virtualization,
  #     QEMU, VMware, VirtualBox, Hyper-V, Bochs)
  #   - presence of a virtiofs/9p/fuse.osxfs/nfs mount anywhere in the
  #     container (the host-shared filesystem is mounted somewhere; ergo
  #     this is a Mac/Windows runtime)
  local kernel_release product_name verdict in_vm=0
  kernel_release=$(uname -r 2>/dev/null || echo "")
  case "$kernel_release" in
    *linuxkit*|*lima*|*colima*|*microsoft*|*WSL*)
      in_vm=1
      ;;
  esac
  if [ "$in_vm" = "0" ]; then
    product_name=$(cat /sys/class/dmi/id/product_name 2>/dev/null || echo "")
    case "$product_name" in
      *Virtual*|*QEMU*|*VMware*|*VirtualBox*|*Bochs*|*HVM*|*KVM*)
        in_vm=1
        ;;
    esac
  fi
  if [ "$in_vm" = "0" ] && grep -qE ' (virtiofs|9p|fuse\.osxfs|nfs4?) ' /proc/self/mountinfo 2>/dev/null; then
    in_vm=1
  fi

  case "$fstype" in
    virtiofs|9p|fuse|fuse.osxfs|nfs|nfs4|cifs|smbfs)
      verdict=host
      ;;
    overlay|tmpfs|aufs)
      verdict=vm
      ;;
    ext4|xfs|btrfs|zfs)
      if [ "$in_vm" = "1" ]; then
        verdict=vm
      else
        verdict=host
      fi
      ;;
    *)
      verdict=unknown
      ;;
  esac

  case "$verdict" in
    host)
      echo "[output] ${target} -> ${root}  (your computer, files will be saved)"
      return 0
      ;;
    unknown)
      echo "[output] ${target} -> ${root}  (filesystem: ${fstype})"
      return 0
      ;;
  esac

  # verdict == vm: print the multi-line warning.
  cat >&2 <<WARN

========================================================================
  WARNING: build outputs are about to be saved INSIDE Docker, not on
  your computer.
========================================================================
  You ran:  docker run ... -v <something>:${target} ...

  On macOS and Windows, Docker runs inside a small Linux virtual
  machine. The path you connected with -v (${root}) is a folder
  inside that VM. Files written there will not appear on your Mac
  or PC, and they will disappear when the container exits.

  Docker shares your home folder (/Users/... on macOS, C:\\Users\\...
  on Windows) with the VM automatically. Other folders -- /tmp, /var,
  /opt, /private -- are NOT shared by default.

  To fix this, choose an output folder under your home directory.
  For example, in the directory where you ran docker:

      mkdir -p out
      docker run ... -v "\$(pwd)/out:${target}" ...

  The build will continue. If you want to recover the outputs from
  this run after it finishes, run:

      docker run --rm \\
        -v "${root}:/from-docker" \\
        -v "\$(pwd)/out:/to-host" \\
        alpine cp -a /from-docker/. /to-host/

========================================================================

WARN
}

show_help() {
  cat <<'EOF'
docker-entrypoint.sh — opencascade.js Docker dispatcher

Subcommands (Nx-cached):
  full <yaml>           Full pipeline (apply-patches + pch + generate + compile-bindings + compile-sources + link)
  link <yaml>           Link only (reuses compiled .o files; fastest)
  compile-bindings      Recompile Embind .cpp files
  compile-sources       Recompile OCCT static libraries via CMake
  pch                   Rebuild flat includes + precompiled header
  generate              Regenerate Embind .cpp + .d.ts.json fragments
  apply-patches         (Re)apply OCCT source patches

Subcommands (non-cached):
  validate <yaml>       Validate YAML config without building
  nx <args...>          Pass-through to `npx nx <args...>`

Anything else is forwarded to /opencascade.js/build-wasm.sh for backwards compat.

For persistent caches across runs:
  docker volume create ocjs-nx-cache ocjs-build-cache
  docker run --rm \
    -v ocjs-nx-cache:/opencascade.js/.nx \
    -v ocjs-build-cache:/opencascade.js/build \
    -v $(pwd)/my.yml:/src/my.yml:ro \
    -v $(pwd)/output:/output \
    opencascade-js full /src/my.yml
EOF
}

if [ "$#" -eq 0 ]; then
  show_help
  exit 1
fi

cmd="$1"
shift || true

# Print where build outputs will actually land BEFORE anything else, so the
# message is unmissable at the top of the user's terminal. Runs for every
# invocation -- including --help -- so users can sanity-check their -v
# argument without committing to a multi-minute build.
print_output_mount_receipt

case "$cmd" in
  --help|-h|help)
    show_help
    exit 0
    ;;
esac

cd "$OCJS_ROOT"

run_nx_with_yaml() {
  local target="$1"
  local yaml="${2:-}"
  if [ -z "$yaml" ]; then
    echo "ERROR: '$cmd' requires a YAML config path argument" >&2
    show_help
    exit 1
  fi
  if [ ! -f "$yaml" ]; then
    echo "ERROR: YAML config not found: $yaml" >&2
    exit 1
  fi
  local yaml_abs
  yaml_abs="$(cd "$(dirname "$yaml")" && pwd)/$(basename "$yaml")"
  export OCJS_YAML="$yaml_abs"
  exec npx nx run "ocjs:$target"
}

run_nx_simple() {
  local target="$1"
  exec npx nx run "ocjs:$target"
}

case "$cmd" in
  full|link)
    # `full` and `link` both resolve to ocjs:link — its Nx dependsOn graph
    # transitively pulls apply-patches, pch, generate, compile-bindings, and
    # compile-sources, with cache reuse wherever inputs are unchanged.
    run_nx_with_yaml "link" "${1:-}"
    ;;
  apply-patches|pch|generate|compile-bindings|compile-sources|dts|provenance|validate-build)
    run_nx_simple "$cmd"
    ;;
  validate)
    yaml="${1:-}"
    if [ -z "$yaml" ]; then
      echo "ERROR: validate requires a YAML config path argument" >&2
      exit 1
    fi
    exec ./build-wasm.sh validate "$yaml"
    ;;
  nx)
    exec npx nx "$@"
    ;;
  *)
    # Backwards compatibility: forward anything unrecognised to build-wasm.sh.
    exec ./build-wasm.sh "$cmd" "$@"
    ;;
esac
