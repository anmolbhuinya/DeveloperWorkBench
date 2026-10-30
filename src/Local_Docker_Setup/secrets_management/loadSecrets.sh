#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
#  loadSecrets.sh
#
#  Reads .secrets_env and outputs all resolved KEY=value pairs to stdout.
#  The caller captures the output into a variable (CREDS) and passes it
#  downstream as a parameter to scripts that need resolved credentials.
#
#  This script has NO knowledge of wl.properties or vault: references.
#  It simply parses .secrets_env and flattens all JSON secret fields into
#  KEY=value lines — one line per field across all secrets.
#
#  Downstream scripts (updateConfigurationFiles.sh) receive CREDS and use
#  it to resolve vault: placeholders in runtime.properties.
#  checkConfig.sh reads credentials directly from wl.properties as it
#  always has — if wl.properties has a real value it uses that; if it has
#  a vault: placeholder the orchestrating script substitutes from CREDS
#  before the call.
#
#  USAGE
#    CREDS=$(loadSecrets.sh [OPTIONS])
#
#  OPTIONS
#    --secrets-env <file>   Path to .secrets_env
#                           Default: ~/.secrets_env
#    --dry-run              Print key names only (values masked as ****)
#    --help, -h             Show this help
#
#  OUTPUT FORMAT
#    One KEY=value line per secret field found in .secrets_env.
#    Keys are the JSON field names; values are raw (unquoted) strings.
#    Using raw values avoids eval in consumers — the format is safe because
#    AWS Secrets Manager JSON values cannot contain literal newlines.
#
#    artemis-username=admin
#    artemis-password=admin
#    default-password=denovis10x
#    oltp-password=hedge
#    dw-password=hedge
#    ...
#
#  EXAMPLE
#    # Load all secrets from .secrets_env into CREDS
#    CREDS=$(loadSecrets.sh --secrets-env ~/.secrets_env)
#
#    # Pass to updateConfigurationFiles.sh — resolves vault: refs in runtime.properties
#    updateConfigurationFiles.sh \
#        --local \
#        --credentials "$CREDS" \
#        --config "$SECRETS_DIR/payor_configuration_file_path.yaml"
#
#    # checkConfig reads wl.properties directly as always — no changes needed
#    $DOMAIN_HOME/tools/bin/checkConfig.sh --database
#
# ─────────────────────────────────────────────────────────────────────────────

_LS_SECRETS_ENV="${HOME}/.secrets_env"
_LS_DRY_RUN=0

_ls_parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --secrets-env)
        [[ -z "${2:-}" ]] && { echo "ERROR: --secrets-env requires a path." >&2; return 1; }
        _LS_SECRETS_ENV="$2"; shift 2 ;;
      --dry-run) _LS_DRY_RUN=1; shift ;;
      --help|-h)
        grep '^#' "${BASH_SOURCE[0]}" | grep -v '^#!/' | sed 's/^# \{0,2\}//'
        return 0 ;;
      *)
        echo "ERROR: Unknown argument: $1" >&2
        return 1 ;;
    esac
  done
}

# Parse .secrets_env and emit KEY=value for every JSON field in every secret.
# .secrets_env format (produced by fetchAWSSecrets.sh):
#   hrp-payor-dev/payor-creds="{
#       \"default-password\":\"denovis10x\",
#       \"oltp-password\":\"hedge\"
#   }",
_ls_main() {
  _ls_parse_args "$@" || return 1

  if [[ ! -f "$_LS_SECRETS_ENV" ]]; then
    echo "ERROR: .secrets_env not found: $_LS_SECRETS_ENV" >&2
    echo "       Run fetchAWSSecrets.sh first, or use --secrets-env <file>" >&2
    return 1
  fi

  echo "  [loadSecrets] secrets-env : $_LS_SECRETS_ENV" >&2

  local resolved=0

  # Collect the full multi-line content of .secrets_env
  local content
  content=$(cat "$_LS_SECRETS_ENV")

  # Process each secret block: key="{...}"
  # Extract the JSON value for each secret path and flatten all fields
  local secret_path raw collecting
  collecting=0
  raw=""

  while IFS= read -r line; do
    line="${line%$'\r'}"

    # Skip comment and blank lines
    [[ "$line" == \#* || -z "${line// }" ]] && continue

    # New secret entry starts: path="{...
    if [[ $collecting -eq 0 && "$line" == *'="{'* ]]; then
      secret_path="${line%%=*}"
      raw="${line#*=}"
      collecting=1
      # Single-line value ends with }" or }",
      if [[ "$raw" == *'}"'* ]]; then
        collecting=0
        _ls_emit_fields "$secret_path" "$raw"
        raw=""
      fi
      continue
    fi

    if [[ $collecting -eq 1 ]]; then
      raw="${raw} ${line}"
      if [[ "$line" == *'}"'* ]]; then
        collecting=0
        _ls_emit_fields "$secret_path" "$raw"
        raw=""
      fi
    fi

  done <<< "$content"

  echo "  [loadSecrets] Done." >&2
  return 0
}

# Emit KEY=value lines for each field in a secret's JSON object.
_ls_emit_fields() {
  local secret_path="$1"
  local raw="$2"

  # Strip trailing comma after }"
  raw="${raw%,}"; raw="${raw% }"
  # Strip outer double-quotes: "{ ... }" -> { ... }
  local inner="${raw#\"}"; inner="${inner%\"}"
  # Unescape \" -> "
  local unescaped="${inner//\\\"/\"}"

  # Extract every "field":"value" pair from the JSON object
  # Use grep to find all quoted key:value pairs
  while IFS= read -r pair; do
    [[ -z "$pair" ]] && continue
    # pair looks like: "field-name":"value"
    local key val
    key=$(printf '%s' "$pair" | sed 's/^"\([^"]*\)".*/\1/')
    val=$(printf '%s' "$pair" | sed 's/^"[^"]*"[[:space:]]*:[[:space:]]*"\(.*\)"$/\1/')
    [[ -z "$key" || "$key" == "$val" ]] && continue

    if [[ $_LS_DRY_RUN -eq 1 ]]; then
      echo "  [dry-run] ${key}=****  (from ${secret_path})" >&2
    else
      # Print raw key=value to stdout — no shell quoting.
      # Consumers assign directly (val="$v") with no eval needed.
      printf '%s=%s\n' "$key" "$val"
    fi

  done < <(printf '%s' "$unescaped" \
    | grep -o '"[^"]*"[[:space:]]*:[[:space:]]*"[^"]*"')
}

_ls_main "$@"
