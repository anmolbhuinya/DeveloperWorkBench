#!/usr/bin/env bash

# -----------------------------------------------------------------------------
#
# Usage:
#   ./env-setter [--adaptor | --webui | --websocket] --version <version-prefix> [--write]
#
# Behavior:
#   --webui	-> image: payor-ui-react
#   --websocket	-> image: payor-adaptor-websocket
#   --adaptor	-> image: payor-rest-adaptor
#
#   If none of --webui/--adaptor/--websocket is passed, operate on ALL THREE.
#   --write will ALWAYS write all three versions to a .env file with backup.
#
# .env format (KEY=VALUE):
#   VERSION=<prefix>
#   WEBUI_VERSION=<latest image of payor-ui-react for the provided VERSION>
#   ADAPTOR_VERSION=<latest image of payor-rest-adaptor for the provided VERSION>
#   WEBSOCKET_VERSION=<latest image of payor-adaptor-websocket  for the provided VERSION>
#
# Backup behavior:
#   If .env exists, it is moved to .env-<last_modified_timestamp>
#   Timestamp is derived from file mtime; format: YYYYmmddHHMMSS
# -----------------------------------------------------------------------------

set -o pipefail

NEXUS_URL="https://nexus.headquarters.healthedge.com:8082/service/extdirect"

usage() {
  cat <<USAGE
Usage: $0 [--adaptor | --webui | --websocket] --version <version> [--write]
Options:
  --version   Version prefix (e.g., 25.1)   <mandatory>
  --write     Write all versions to .env (backs up existing .env)
  --websocket Use image name 'payor-adaptor-websocket'
  --webui     Use image name 'payor-ui-react'
  --adaptor   Use image name 'payor-rest-adaptor'


Examples:
  $0 --version 25.1
  $0 --version 25.1 --write
  $0 --webui --version 25.1
  $0 --adaptor --version 25.1
  $0 --websocket --version 25.1
USAGE
  exit 1
}

# ---- HELPERS-----------------------------------------------------

get_mtime_epoch() {
  local file="$1"
  if [[ ! -e "$file" ]]; then
    echo ""
    return 0
  fi
  if stat --version >/dev/null 2>&1; then
    stat -c %Y "$file"           # GNU
  else
    stat -f %m "$file"           # BSD/macOS
  fi
}

format_epoch_ts() {
  local epoch="$1"
  if [[ -z "$epoch" ]]; then
    echo ""
    return 0
  fi
  if date -d @"0" +%Y >/dev/null 2>&1; then
    date -d @"$epoch" +%Y%m%d%H%M%S   # GNU
  else
    date -r "$epoch" +%Y%m%d%H%M%S    # BSD/macOS
  fi
}

backup_env_if_exists() {
  local env_file=".env"
  if [[ -f "$env_file" ]]; then
    local mtime_epoch ts
    mtime_epoch="$(get_mtime_epoch "$env_file")"
    ts="$(format_epoch_ts "$mtime_epoch")"
    [[ -z "$ts" ]] && ts="$(date +%Y%m%d%H%M%S)"
    mv "$env_file" ".env-$ts"
    echo "Backed up existing .env to .env-$ts"
  fi
}

# ---- Nexus fetch ---------------------------------------------------------------

fetch_docker_image_version() {
  local image_name="$1"
  local image_version_prefix="$2"

  curl "$NEXUS_URL" \
    -H 'Content-Type: application/json' \
    -H 'X-Requested-With: XMLHttpRequest' \
    --data-raw '{
      "action":"coreui_Search",
      "method":"read",
      "data":[{
        "formatSearch":true,
        "page":1,"start":0,"limit":1,
        "sort":[{"property":"lastBlobUpdated","direction":"DESC"}],
        "filter":[
          {"property":"format","value":"docker"},
          {"property":"name.raw","value":"'"$image_name"'"},
          {"property":"version","value":"'"$image_version_prefix"'*"}
        ]
      }],
      "type":"rpc","tid":21
    }' \
    --silent --show-error --insecure \
    | awk 'match($0, /"version":"([^"]+)"/, arr) { print arr[1]; exit } END { if (NR==0) print "EMPTY" }'
}

# ---- Image mapping ----------------------------------------------
resolve_image_name() {
  case "$1" in
    webui)      echo "payor-ui-react" ;;
    websocket)  echo "payor-adaptor-websocket" ;;
    adaptor)    echo "payor-rest-adaptor" ;;
    *)          echo "" ;;
  esac
}

get_version_for_target() {
  local target="$1"
  local prefix="$2"
  local image
  image="$(resolve_image_name "$target")"
  if [[ -z "$image" ]]; then
    echo "EMPTY"
    return
  fi
  fetch_docker_image_version "$image" "$prefix"
}

# ---- ------------MAIN------------------------------------------------------------

VERSION_PREFIX=""
DO_WRITE=0
declare -a TARGETS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --webui)      TARGETS+=("webui"); shift ;;
    --adaptor)    TARGETS+=("adaptor"); shift ;;
    --websocket)  TARGETS+=("websocket"); shift ;;
    --version)    VERSION_PREFIX="${2:-}"; shift 2 ;;
    --write)      DO_WRITE=1; shift ;;
    -h|--help)    usage ;;
    *)            echo "Unknown option: $1"; usage ;;
  esac
done

if [[ -z "$VERSION_PREFIX" ]]; then
  echo "ERROR: --version <prefix> is required."
  usage
fi

# If no specific targets chosen (and not writing), default to all
if [[ ${#TARGETS[@]} -eq 0 ]]; then
  TARGETS=("webui" "adaptor" "websocket")
fi


if [[ $DO_WRITE -eq 1 ]]; then
  # Always resolve all three for .env
  webui_ver="$(get_version_for_target "webui" "$VERSION_PREFIX")"
  adaptor_ver="$(get_version_for_target "adaptor" "$VERSION_PREFIX")"
  websocket_ver="$(get_version_for_target "websocket" "$VERSION_PREFIX")"

  backup_env_if_exists

  cat > ./.env <<EOF
VERSION=${VERSION_PREFIX}
WEBUI_VERSION=${webui_ver}
ADAPTOR_VERSION=${adaptor_ver}
WEBSOCKET_VERSION=${websocket_ver}
EOF

  echo "Wrote versions to ./.env"
  cat ./.env
  exit 0
fi

# if not --write then print versions to stdout
if [[ ${#TARGETS[@]} -eq 1 ]]; then
  ver="$(get_version_for_target "${TARGETS[0]}" "$VERSION_PREFIX")"
  echo "$ver"
else
  for t in "${TARGETS[@]}"; do
    v="$(get_version_for_target "$t" "$VERSION_PREFIX")"
    echo "${t}: ${v}"
  done
fi
