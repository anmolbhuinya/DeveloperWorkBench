#!/bin/bash
# ─────────────────────────────────────────
#  fetchAWSSecrets.sh
#
#  Fetches secrets from AWS Secrets Manager using full secret paths
#  defined in .secrets_path, and writes them to .secrets_env.
#
#  If .secrets_env already exists and was fetched within CACHE_TTL_HOURS,
#  it will be reused without hitting AWS again.
#
#  .secrets_path format:
#    {
#      "region": "us-east-1",
#      "secrets": [
#        "hrp-payor-dev/artemis-creds",
#        "hrp-payor-dev/payor-creds"
#      ]
#    }
#
#  Each secret's full path is used as the key in .secrets_env:
#    hrp-payor-dev/artemis-creds=<value>
#
#  Usage:
#    chmod +x fetchAWSSecrets.sh
#    aws sso login --profile <your-profile>
#    AWS_PROFILE=<your-profile> ./fetchAWSSecrets.sh [OPTIONS]
#
#  Options:
#    --force, -f           Force re-fetch secrets from AWS, ignoring cache
#    --ttl <hours>         Override cache TTL (default: CACHE_TTL_HOURS below)
#    --output <file>       Override output file (default: ~/.secrets_env)
#    --secrets-file <file> Override secrets path file (default: ./.secrets_path)
#    --help, -h            Show this help message
#
#  Prerequisites:
#    - AWS CLI installed and configured (aws sso login --profile <name>)
#    - jq installed (brew install jq / apt install jq)
#    - macOS: bash 4+ required for mapfile (brew install bash)
#      The script uses parse_epoch() to handle both GNU date (Linux/WSL)
#      and BSD date (macOS) transparently — no extra install needed for dates.
# ─────────────────────────────────────────

set -euo pipefail

# ─── Configuration ───────────────────────────────────────────────────────────

OUTPUT_FILE="$HOME/.secrets_env"
SECRETS_FILE="./.secrets_path"
SECRETS_FILE_EXPLICIT=0   # set to 1 when --secrets-file is supplied; suppresses auto-discovery

# How many hours to consider .secrets_env fresh before re-fetching from AWS.
# Set to 0 to always fetch. Can be overridden at runtime with --ttl flag.
CACHE_TTL_HOURS=24

# ─── Internal flags ───────────────────────────────────────────────────────────

FORCE=0

# ─── Help ─────────────────────────────────────────────────────────────────────

show_help() {
  cat <<EOF
─────────────────────────────────────────────────────────────────────
  fetchAWSSecrets.sh — AWS Secrets Manager secret fetcher
─────────────────────────────────────────────────────────────────────

USAGE
  AWS_PROFILE=<profile> ./fetchAWSSecrets.sh [OPTIONS]

DESCRIPTION
  Fetches secrets from AWS Secrets Manager using the full secret paths
  listed in .secrets_path and writes them to .secrets_env.

  On subsequent runs, if .secrets_env was fetched within CACHE_TTL_HOURS,
  the cached file is reused and AWS is not contacted again.

  Each secret is stored in .secrets_env using its full path as the key:
    hrp-payor-dev/artemis-creds=<secret value>

OPTIONS
  --force, -f
      Force re-fetch all secrets from AWS even if a fresh cache exists.

  --ttl <hours>
      Override the cache TTL for this run only.
      Default: ${CACHE_TTL_HOURS}h. Set to 0 to always fetch.
      Example: --ttl 8

  --output <file>
      Write fetched secrets to <file> instead of the default.
      Default: ~/.secrets_env
      Example: --output staging.env

  --secrets-file <file>
      Read secret paths from <file> instead of the default.
      Default: .secrets_path in the current directory
      Example: --secrets-file /path/to/.secrets_path

      AUTO-DISCOVERY (when --secrets-file is not supplied):
      The script looks for ./.secrets_path in the current working directory.
      Place a .secrets_path in the project directory to use it without passing
      --secrets-file on every invocation.  The script also adds .secrets_path
      and .secrets_env to the repo's local .gitignore automatically.

  --help, -h
      Show this help message and exit.

CONFIGURATION (set as environment variables before running)
  AWS_PROFILE         Required. AWS SSO profile name used with aws sso login.
                      Example: AWS_PROFILE=he-bedrockinvocation-dev-902338856854
  CACHE_TTL_HOURS     Hours before cached .secrets_env expires (default: 24)

SECRETS FILE FORMAT (.secrets_path)
  {
    "region": "us-east-1",
    "secrets": [
      "hrp-payor-dev/artemis-creds",
      "hrp-payor-dev/payor-creds"
    ]
  }

  - region    : AWS region where the secrets are stored
  - secrets   : full secret path/name as shown in AWS Secrets Manager

CACHE BEHAVIOUR
  The first line of .secrets_env stores a FETCHED_AT timestamp:
    # FETCHED_AT:2026-05-19T10:30:00Z
  On each run the age is compared against CACHE_TTL_HOURS.
  Use --force to bypass the cache and always re-fetch.

EXAMPLES
  # Login to AWS SSO first
  aws sso login --profile he-bedrockinvocation-dev-902338856854

  # Normal run — reuse cache if fresh
  AWS_PROFILE=he-bedrockinvocation-dev-902338856854 ./fetchAWSSecrets.sh

  # Force refresh from AWS
  AWS_PROFILE=he-bedrockinvocation-dev-902338856854 ./fetchAWSSecrets.sh --force

  # Use a 4-hour TTL for this run
  AWS_PROFILE=he-bedrockinvocation-dev-902338856854 ./fetchAWSSecrets.sh --ttl 4

  # Use a different secrets file (e.g. for staging)
  AWS_PROFILE=he-bedrockinvocation-dev-902338856854 ./fetchAWSSecrets.sh --secrets-file /path/to/staging/.secrets_path

─────────────────────────────────────────────────────────────────────
EOF
}

# ─── Argument parsing ─────────────────────────────────────────────────────────

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --force|-f)
        FORCE=1
        shift
        ;;
      --ttl)
        if [[ -z "${2:-}" || ! "${2}" =~ ^[0-9]+([.][0-9]+)?$ ]]; then
          echo "✖  --ttl requires a numeric argument (hours). E.g. --ttl 8"
          exit 1
        fi
        CACHE_TTL_HOURS="$2"
        shift 2
        ;;
      --output)
        if [[ -z "${2:-}" ]]; then
          echo "✖  --output requires a filename argument."
          exit 1
        fi
        OUTPUT_FILE="$2"
        shift 2
        ;;
      --secrets-file)
        if [[ -z "${2:-}" ]]; then
          echo "✖  --secrets-file requires a filename argument."
          exit 1
        fi
        SECRETS_FILE="$2"
        SECRETS_FILE_EXPLICIT=1
        shift 2
        ;;
      --help|-h)
        show_help
        exit 0
        ;;
      *)
        echo "✖  Unknown argument: $1"
        echo "   Run with --help to see available options."
        exit 1
        ;;
    esac
  done
}

# ─── Cache check ──────────────────────────────────────────────────────────────

make_timestamp_header() {
  echo "# FETCHED_AT:$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
}

read_cached_timestamp() {
  local first_line
  first_line=$(head -1 "$OUTPUT_FILE" 2>/dev/null || true)
  if [[ "$first_line" =~ ^#\ FETCHED_AT:(.+)$ ]]; then
    echo "${BASH_REMATCH[1]}"
  fi
}

# ─── Portable timestamp → epoch ───────────────────────────────────────────────
# Converts an ISO 8601 UTC timestamp (YYYY-MM-DDTHH:MM:SSZ) to a Unix epoch.
#
# GNU date  (Linux / WSL)  : date -d  "2026-05-19T10:30:00Z" +"%s"
# BSD date  (macOS)        : date -j -f "%Y-%m-%dT%H:%M:%SZ" "2026-05-19T10:30:00Z" +"%s"
#
# The two forms are mutually exclusive — GNU date rejects -j and BSD date
# rejects -d — so we probe GNU first and fall back to BSD.  If neither
# succeeds (unknown date implementation) we return 1 so the caller can
# treat the cache as stale rather than crashing.
parse_epoch() {
  local ts="$1"
  local epoch

  # Try GNU date (Linux, WSL)
  if epoch=$(date -d "$ts" +"%s" 2>/dev/null) && [[ -n "$epoch" ]]; then
    echo "$epoch"
    return 0
  fi

  # Fall back to BSD date (macOS)
  if epoch=$(date -j -f "%Y-%m-%dT%H:%M:%SZ" "$ts" +"%s" 2>/dev/null) && [[ -n "$epoch" ]]; then
    echo "$epoch"
    return 0
  fi

  # Neither form succeeded
  return 1
}

is_cache_fresh() {
  if [[ ! -f "$OUTPUT_FILE" ]]; then
    echo "  ℹ  No cache file found — will fetch from AWS."
    return 1
  fi

  local cached_ts
  cached_ts=$(read_cached_timestamp)

  if [[ -z "$cached_ts" ]]; then
    echo "  ⚠  Cache file exists but has no FETCHED_AT timestamp — treating as stale."
    return 1
  fi

  local cached_epoch
  cached_epoch=$(parse_epoch "$cached_ts") || {
    echo "  ⚠  Could not parse cached timestamp \"$cached_ts\" — treating as stale."
    return 1
  }

  local now_epoch
  now_epoch=$(date -u +"%s")
  local age_seconds=$(( now_epoch - cached_epoch ))
  local ttl_seconds=$(( CACHE_TTL_HOURS * 3600 ))
  local age_display
  age_display=$(awk "BEGIN { printf \"%.1f\", $age_seconds / 3600 }")

  if [[ $age_seconds -lt $ttl_seconds ]]; then
    echo "  ✔  Cache is fresh — fetched ${age_display}h ago (TTL: ${CACHE_TTL_HOURS}h)"
    echo "     Reusing: $(realpath "$OUTPUT_FILE")"
    echo "     Use --force to re-fetch from AWS."
    return 0
  else
    echo "  ℹ  Cache is stale — fetched ${age_display}h ago (TTL: ${CACHE_TTL_HOURS}h) — re-fetching."
    return 1
  fi
}

# ─── Helpers ──────────────────────────────────────────────────────────────────

escape_env_value() {
  local value="$1"
  if [[ -z "$value" ]] || echo "$value" | grep -qP '[\s"'"'"'`$\\#]'; then
    value="${value//\\/\\\\}"
    value="${value//\"/\\\"}"
    echo "\"$value\""
  else
    echo "$value"
  fi
}

ensure_gitignore() {
  # ── Global gitignore for home-directory files ─────────────────────────────
  # ~/.secrets_env and ~/.secrets_path live outside any repo, so we protect
  # them via the global gitignore using absolute $HOME-prefixed paths.
  local global_gitignore
  global_gitignore=$(git config --global core.excludesFile 2>/dev/null || true)
  if [[ -z "$global_gitignore" ]]; then
    if [[ -d "${XDG_CONFIG_HOME:-$HOME/.config}/git" ]]; then
      global_gitignore="${XDG_CONFIG_HOME:-$HOME/.config}/git/ignore"
    else
      global_gitignore="$HOME/.gitignore_global"
    fi
    git config --global core.excludesFile "$global_gitignore" 2>/dev/null || true
  fi
  global_gitignore="${global_gitignore/#\~/$HOME}"

  local -a patterns=("$HOME/.secrets_env")
  local needs_block=0
  for pat in "${patterns[@]}"; do
    grep -qxF "$pat" "$global_gitignore" 2>/dev/null || { needs_block=1; break; }
  done
  if [[ $needs_block -eq 1 ]]; then
    mkdir -p "$(dirname "$global_gitignore")"
    {
      echo ""
      echo "# AWS Secrets Manager — local credential cache (never commit)"
      for pat in "${patterns[@]}"; do
        grep -qxF "$pat" "$global_gitignore" 2>/dev/null || echo "$pat"
      done
    } >> "$global_gitignore"
    echo "  ✔  Added to global gitignore ($global_gitignore):"
    for pat in "${patterns[@]}"; do echo "       $pat"; done
  fi

  # ── Local gitignore for current-directory .secrets_path ──────────────────
  # If .secrets_path was auto-discovered in the current directory (i.e. inside
  # a project repo) add .secrets_path and .secrets_env to the repo's own
  # .gitignore so they can never be accidentally committed.
  if [[ "$SECRETS_FILE_EXPLICIT" -eq 0 && "$SECRETS_FILE" == "./.secrets_path" ]]; then
    local git_root
    git_root=$(git rev-parse --show-toplevel 2>/dev/null || true)
    if [[ -n "$git_root" ]]; then
      local local_gitignore="$git_root/.gitignore"
      local local_needs_block=0
      grep -qxF ".secrets_env" "$local_gitignore" 2>/dev/null || local_needs_block=1
      if [[ $local_needs_block -eq 1 ]]; then
        {
          echo ""
          echo "# AWS Secrets Manager — never commit"
          echo ".secrets_env"
        } >> "$local_gitignore"
        echo "  ✔  Added to local gitignore ($local_gitignore): .secrets_env"
      fi
    fi
  fi
}

# ─── Secrets file auto-discovery ─────────────────────────────────────────────
# Resolves SECRETS_FILE when --secrets-file was not explicitly supplied.
#
# Priority (highest → lowest):
#   1. --secrets-file <file>   explicit CLI override  (SECRETS_FILE_EXPLICIT=1)
#   2. ./.secrets_path         current working directory
#
# If ./.secrets_path is not found, main() will report "file not found".
resolve_secrets_file() {
  if [[ "$SECRETS_FILE_EXPLICIT" -eq 1 ]]; then return; fi
  # Default is already ./.secrets_path — nothing to do if it exists or not;
  # main()'s existence check produces a meaningful "file not found" error.
}

# ─── AWS fetch ────────────────────────────────────────────────────────────────

# Fetch a single secret by its full path. Prints the secret value to stdout.
fetch_secret() {
  local secret_path
  secret_path=$(echo "$1" | tr -d '\r')
  local aws_region="$2"
  local result

  result=$(aws secretsmanager get-secret-value \
    --region "$aws_region" \
    --profile "$AWS_PROFILE" \
    --secret-id "$secret_path" \
    --query "SecretString" \
    --output text 2>&1) || {
    if echo "$result" | grep -qi "AccessDenied\|AuthFailure\|NotAuthorized"; then
      echo "  ⚠  Skipping \"$secret_path\": permission denied" >&2
    elif echo "$result" | grep -qi "ResourceNotFoundException"; then
      echo "  ⚠  Skipping \"$secret_path\": secret not found" >&2
    elif echo "$result" | grep -qi "ExpiredToken\|TokenExpired"; then
      echo "  ⚠  Skipping \"$secret_path\": SSO token expired — run: aws sso login --profile $AWS_PROFILE" >&2
    else
      echo "  ⚠  Skipping \"$secret_path\": $result" >&2
    fi
    return 1
  }

  # If the secret value is a JSON object, return it as-is (caller can process it)
  echo "$result"
}

# ─── Main ─────────────────────────────────────────────────────────────────────

main() {
  parse_args "$@"
  resolve_secrets_file

  # ── AWS_PROFILE must be explicitly set ────────────────────────────────────
  if [[ -z "${AWS_PROFILE:-}" ]]; then
    echo "⚠  AWS_PROFILE is not set."
    echo "   The script intentionally does not fall back to any default profile."
    echo "   First run: aws sso login --profile <your-profile-name>"
    echo "   Then run : AWS_PROFILE=<your-profile-name> ./fetchAWSSecrets.sh"
    echo "   Example  : AWS_PROFILE=he-bedrockinvocation-dev-902338856854 ./fetchAWSSecrets.sh"
    if [[ ! -f "$OUTPUT_FILE" ]]; then
      local fallback="/opt/melissadata/.secrets_env"
      if [[ -f "$fallback" ]]; then
        cp "$fallback" "$OUTPUT_FILE"
        echo "  ✔  Copied fallback secrets: $fallback → $OUTPUT_FILE"
        ensure_gitignore
        exit 0
      else
        echo "✖  No AWS_PROFILE and no fallback found at $fallback"
      fi
    fi
    exit 1
  fi

  # ── Validate .secrets_path exists ───────────────────────────────────────
  if [[ ! -f "$SECRETS_FILE" ]]; then
    echo "✖  Secrets file \"$SECRETS_FILE\" not found."
    echo "   Create it or use --secrets-file to point to your .secrets_path file."
    exit 1
  fi

  # ── Read region and secret list from .secrets_path ─────────────────────
  if ! jq empty "$SECRETS_FILE" 2>/dev/null; then
    echo "✖  \"$SECRETS_FILE\" is not valid JSON."
    exit 1
  fi

  local aws_region
  aws_region=$(jq -r '.region // "us-east-1"' "$SECRETS_FILE" | tr -d '\r')

  local -a secret_paths
  mapfile -t secret_paths < <(jq -r '.secrets[]' "$SECRETS_FILE" | tr -d '\r')

  if [[ ${#secret_paths[@]} -eq 0 ]]; then
    echo "✖  No secrets listed in \"$SECRETS_FILE\"."
    exit 1
  fi

  echo "─────────────────────────────────────────"
  echo "  AWS Secrets Manager → $OUTPUT_FILE"
  echo "─────────────────────────────────────────"
  echo "  Region  : $aws_region"
  echo "  Profile : $AWS_PROFILE"
  echo "  Secrets : ${#secret_paths[@]} (from $SECRETS_FILE)"
  if [[ "$SECRETS_FILE_EXPLICIT" -eq 0 ]]; then
    echo "  SecretsFile: ./.secrets_path (current directory — auto-discovered)"
  fi
  echo "  Output  : $OUTPUT_FILE"
  echo "  TTL     : ${CACHE_TTL_HOURS}h"
  echo "  Force   : $([ "$FORCE" -eq 1 ] && echo yes || echo no)"
  echo ""

  # ── Cache check ───────────────────────────────────────────────────────────
  if [[ "$FORCE" -eq 0 ]] && is_cache_fresh; then
    echo ""
    exit 0
  fi
  [[ "$FORCE" -eq 1 ]] && echo "  ⚡  --force — re-fetching all secrets from AWS."
  echo ""

  # ── Prerequisites ─────────────────────────────────────────────────────────
  if ! command -v aws &>/dev/null; then
    echo "✖  AWS CLI is not installed."
    echo "   Install: https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html"
    exit 1
  fi

  if ! command -v jq &>/dev/null; then
    echo "✖  jq is required but not installed."
    echo "   Install: brew install jq  OR  apt install jq  OR  yum install jq"
    exit 1
  fi

  if ! aws sts get-caller-identity --region "$aws_region" --profile "$AWS_PROFILE" &>/dev/null; then
    echo "⚠  AWS credentials not valid for profile \"$AWS_PROFILE\"."
    echo "   Run: aws sso login --profile $AWS_PROFILE"
    if [[ ! -f "$OUTPUT_FILE" ]]; then
      local fallback="/opt/melissadata/.secrets_env"
      if [[ -f "$fallback" ]]; then
        cp "$fallback" "$OUTPUT_FILE"
        echo "  ✔  Copied fallback secrets: $fallback → $OUTPUT_FILE"
        ensure_gitignore
        exit 0
      else
        echo "✖  No AWS credentials and no fallback found at $fallback"
      fi
    fi
    exit 1
  fi

  # ── Fetch all secrets and write to OUTPUT_FILE ────────────────────────────
  echo "  Fetching ${#secret_paths[@]} secret(s) …"
  echo ""

  {
    make_timestamp_header
    echo "# .secrets_env"
    echo "# Auto-generated from AWS Secrets Manager (region: $aws_region)"
    echo "# DO NOT commit this file to version control"
    echo ""
  } > "$OUTPUT_FILE"

  local fetched=0
  local failed=0

  # Collect all successfully fetched entries first so we know which is last
  # (the last entry gets no trailing comma)
  local -a fetched_keys=()
  local -a fetched_values=()

  set +e
  for secret_path in "${secret_paths[@]}"; do
    local fetch_rc
    value=$(fetch_secret "$secret_path" "$aws_region"); fetch_rc=$?
    if [[ $fetch_rc -ne 0 ]]; then
      failed=$((failed + 1))
      continue
    fi
    fetched_keys+=("$secret_path")
    fetched_values+=("$value")
    echo "  ✔  ${secret_path}=****"
    fetched=$((fetched + 1))
  done
  set -e

  # Write entries to OUTPUT_FILE — append a comma after }" on every line except the last
  local total_fetched=${#fetched_keys[@]}
  for (( idx=0; idx<total_fetched; idx++ )); do
    local escaped
    escaped=$(escape_env_value "${fetched_values[$idx]}")
    if [[ $idx -lt $(( total_fetched - 1 )) ]]; then
      # Not the last entry — append comma after the closing }"
      printf '%s=%s,\n' "${fetched_keys[$idx]}" "$escaped" >> "$OUTPUT_FILE"
    else
      # Last entry — no trailing comma
      printf '%s=%s\n' "${fetched_keys[$idx]}" "$escaped" >> "$OUTPUT_FILE"
    fi
  done

  echo ""

  if [[ $fetched -eq 0 ]]; then
    echo "  ✖  No secrets were fetched successfully. Aborting."
    rm -f "$OUTPUT_FILE"
    exit 1
  fi

  ensure_gitignore

  echo "  ✔  Fetched $fetched secret(s) → $(realpath "$OUTPUT_FILE")"
  [[ $failed -gt 0 ]] && echo "  ⚠  $failed secret(s) failed — check warnings above."
  echo "─────────────────────────────────────────"
  echo ""
}

main "$@"
