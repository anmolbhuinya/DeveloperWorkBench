#!/bin/bash
# ─────────────────────────────────────────
#  updateConfigurationFiles.sh
#
#  Reads secrets from a local .secrets_env file and propagates them into
#  target configuration files listed in configuration_file_path.json.
#
#  Does NOT fetch any secrets from a vault or cloud provider.
#  Use fetchAWSSecrets.sh first to
#  populate .secrets_env, then run this script to push values into config files.
#
#  OS-aware target selection:
#    Windows / macOS → "docker" targets processed; "local" targets skipped
#    Linux           → "local" targets processed; "docker" targets skipped
#    Override with --docker (force docker) or --local (force local)
#
#  Supported target file types:
#    .properties / .env  — key=vault:<secret-path>:<json-field>
#    .xml / .jocl        — <string value="vault:<secret-path>:<json-field>"/> OR <tag>vault:<secret-path>:<json-field></tag>
#    .yaml / .yml        — key: vault:<secret-path>:<json-field>
#    .sql / .json / .cfg / .bat — vault:<secret-path>:<json-field> anywhere in content
#
#  Matching logic:
#    Values starting with vault:<name> (case-insensitive) are looked up in
#    .secrets_env using the exact secret name. All other values are untouched.
#
#  Usage:
#    chmod +x updateConfigurationFiles.sh
#    ./updateConfigurationFiles.sh [OPTIONS]
#
#  Options:
#    --env <file>              Path to .secrets_env (default: ~/.secrets_env)
#    --credentials <str>       Pre-resolved KEY=value string produced by loadSecrets.sh.
#                              Passed in memory -- no temp file. Skips re-reading .secrets_env.
#    --load-secrets-script <f> Path to loadSecrets.sh. When provided and --credentials
#                              is not set, updateConfigurationFiles.sh calls it internally
#                              to resolve vault: refs before applying them.
#    --load-secrets-wl-props <f> wl.properties to pass to loadSecrets.sh internally.
#    --config <file>     Override config file (.yaml or .yml, default: ~/configuration_file_path.yaml)
#    --docker            Force processing of docker targets (overrides OS detection)
#    --local             Force processing of local targets (overrides OS detection)
#    --container <name>  Override the container name from configuration_file_path.json
#    --help, -h          Show this help message
# ─────────────────────────────────────────

set -euo pipefail

# ─── Configuration ───────────────────────────────────────────────────────────

OUTPUT_FILE="$HOME/.secrets_env"
# Default config file — deployPayorTomcat.sh and install-tomcat.sh override
# this via --config; standalone runs look for ~/payor_configuration_file_path.yaml.
CONFIG_FILE="$HOME/payor_configuration_file_path.yaml"

# ─── Internal flags (set by argument parsing) ─────────────────────────────────
USE_DOCKER=""           # "docker" = force docker targets, "local" = force local targets, "" = auto-detect
OVERRIDE_CONTAINER=""   # when set, overrides the container name from the YAML config file
LOAD_SECRETS_SCRIPT=""  # path to loadSecrets.sh; set via --load-secrets-script
LOAD_SECRETS_WL_PROPS="" # wl.properties path passed to loadSecrets.sh
CREDENTIALS_STR=""      # pre-resolved credentials string; set via --credentials
FILE_PATH=""            # when set via --filePath, process only this single file as a local target (YAML targets skipped)
FOLDER_PATH=""          # when set via --folderPath, scan folder for supported resource files and process each (YAML targets skipped)
ENV_FILE_EXPLICIT=0     # set to 1 when --env is supplied; distinguishes an explicit override from the ~/.secrets_env default

# ─── OS Detection ─────────────────────────────────────────────────────────────
detect_os() {
  local os
  case "$(uname -s)" in
    Linux*)
      if grep -qi microsoft /proc/version 2>/dev/null; then
        os="windows"   # WSL — treat like Windows/Docker
      else
        os="linux"
      fi
      ;;
    Darwin*)            os="mac"     ;;
    MINGW*|MSYS*|CYGWIN*) os="windows" ;;
    *)                  os="unknown" ;;
  esac
  echo "$os"
}

OS_TYPE=$(detect_os)

# ─── Help ─────────────────────────────────────────────────────────────────────

show_help() {
  cat <<EOF
─────────────────────────────────────────────────────────────────────
  updateConfigurationFiles.sh — Config file updater from .secrets_env
─────────────────────────────────────────────────────────────────────

USAGE
  ./updateConfigurationFiles.sh [OPTIONS]

DESCRIPTION
  Reads secrets from .secrets_env and writes them into target configuration
  files listed in payor_configuration_file_path.yaml (or a custom YAML file).

  Only values already marked as  vault:<key>  in the target files are
  replaced — all other content is left completely untouched.

  No vault or cloud connection is made. Run fetchAWSSecrets.sh
  (or fetchAWSSecrets.sh) first to populate .secrets_env.

OPTIONS
  --env <file>
      Read secrets from <file> instead of the default.
      Default: ~/.secrets_env
      Example: --env staging.env

      AUTO-DISCOVERY (when --env is not supplied):
      The script checks for a .secrets_path file in this order:
        1. ~/.secrets_path      (user home — takes precedence)
        2. ./.secrets_path      (current working directory)
        3. ~/.secrets_env       (fallback default)
      Place a .secrets_path file in ~ or the current directory to override
      the default without passing --env on every invocation.

  --credentials <str>
      Pre-resolved KEY=value credential string produced by loadSecrets.sh.
      Passed in memory (no temp file). Takes priority over --env / YAML source.
      Avoids re-reading .secrets_env when credentials were already resolved by
      the calling script (e.g. to export OLTP_PASSWORD for checkConfig).
      Usage: CREDS=\$(loadSecrets.sh --wl-props "\$WL_PROPS")
             updateConfigurationFiles.sh --credentials "\$CREDS" ...

  --load-secrets-script <file>
      Path to loadSecrets.sh. When provided and --credentials is not set,
      updateConfigurationFiles.sh calls loadSecrets.sh internally to resolve
      vault: refs from --env / .secrets_env. This allows updateConfigurationFiles.sh
      to be self-sufficient without the caller pre-resolving secrets.
      Example: --load-secrets-script "$SECRETS_DIR/loadSecrets.sh"

  --load-secrets-wl-props <file>
      wl.properties to pass to loadSecrets.sh when calling it internally.
      Default: the same file as --env if not set.

  --config <file>
      Use a different configuration YAML file.
      Default: ~/payor_configuration_file_path.yaml
      Example: --config prod-config.yaml

  --docker
      Force processing of docker targets regardless of detected OS.
      Use on Linux when running against a Docker container.

  --local
      Force processing of local targets regardless of detected OS.
      Use when running the script directly inside the server/container.

  --container <name>
      Override the Docker container name for all docker targets, ignoring
      the container value in the YAML config file.
      Useful when running against a different container (e.g. payer-tc-262)
      without editing the YAML config file.
      Example: --container payer-tc-262

  --filePath <file>
      Process only this specific file as a local target, ignoring all targets
      defined in the YAML config file.
      The file must exist on the local filesystem. Env vars in the path
      (e.g. \$DOMAIN_HOME) are expanded automatically.
      Combines with --env / YAML source: / --credentials for secret resolution.
      Example: --filePath \$DOMAIN_HOME/runtime.properties
      Example: --filePath /opt/domains/healthedge/wl.properties

  --folderPath <dir>
      Scan the given directory recursively for supported resource files
      (.sql, .properties, .yaml, .yml, .cfg, .json, .bat) and process each one
      as a local target, ignoring all targets defined in the YAML config file.
      Useful for injecting secrets into all resource files of a module at
      Maven build time without maintaining an explicit file list.
      Env vars in the path are expanded automatically.
      Example: --folderPath \$project_basedir/src/main/resources

  --help, -h
      Show this help message and exit.

CONFIGURATION FILE FORMAT (payor_configuration_file_path.yaml)
  {
    "source": "~/.secrets_env",
    "targets": [
      {
        "type":      "docker",
        "user":      "weblogic",
        "container": "payer-tc-261",
        "path":      "\$DOMAIN_HOME/runtime.properties"
      },
      {
        "type":      "vm",
        "user":      "weblogic",
        "host":      "10.0.0.1",
        "path":      "/opt/app/runtime.properties"
      },
      {
        "type": "local",
        "path": "\$DOMAIN_HOME/runtime.properties"
      }
    ]
  }

  Target types:
    docker  — file lives inside a Docker container (used on Windows/macOS)
    local   — file is on the local filesystem       (used on Linux/server)
    vm      — file is on a remote VM via SSH/SCP    (used on Linux)

OS-AWARE TARGET SELECTION
  OS                    Targets processed
  ──────────────────    ─────────────────────────────────
  Windows (Git Bash)    docker only
  macOS                 docker only
  Linux                 local + vm
  WSL                   treated as Windows → docker only

  Override with --docker or --local flags.

KEY MATCHING LOGIC
  Only values starting with vault: are updated (case-insensitive).
  All other values are left completely untouched.

  Syntax:
    vault:<secret-path>:<json-field>

  <secret-path>  — full secret name as stored in .secrets_env
                   e.g. hrp-payor-dev/artemis-creds
  <json-field>   — key inside the JSON object stored as the secret value
                   e.g. artemis-password

  Properties / flat files (.properties, runtime.properties):
    # key=vault:<secret-path>:<json-field>
    ARTEMIS_PASSWORD=vault:hrp-payor-dev/artemis-creds:artemis-password
    ARTEMIS_USER=vault:hrp-payor-dev/artemis-creds:artemis-username
    OLTPDS_PASSWORD=vault:hrp-payor-dev/oltpds-creds:oltpds-password
    DEFAULT_PASSWORD=vault:hrp-payor-dev/payor-creds:default-password

  XML / JOCL files (.xml, .jocl):
    # Pattern 1 - value attribute: <string value="vault:<secret-path>:<json-field>"/>
    <string value="vault:hrp-payor-dev/oltpds-creds:oltpds-password"/>
    <string value="vault:hrp-payor-dev/artemis-creds:artemis-password"/>

    # Pattern 2 - element content: <tag>vault:<secret-path>:<json-field></tag>
    <Password>vault:hrp-cclassic-dev/sftp-credentials:heservices-dev-password</Password>
    <DatabasePassword>vault:hrp-payor-dev/oltpds-creds:oltpds-password</DatabasePassword>

  YAML files (.yaml, .yml):
    # key: vault:<secret-path>:<json-field>          (unquoted)
    # key: "vault:<secret-path>:<json-field>"        (quoted)
    spring:
      datasource:
        password: vault:hrp-payor-dev/oltpds-creds:oltpds-password
      artemis:
        password: "vault:hrp-payor-dev/artemis-creds:artemis-password"
        username: "vault:hrp-payor-dev/artemis-creds:artemis-username"
      encryption:
        keystore-password: vault:hrp-payor-dev/encryption-creds:encryption-keystore-password

  SQL / JSON / CFG / BAT files (.sql, .json, .cfg, .bat):
    # vault: refs matched anywhere in the file content (plain-text substitution)
    INSERT INTO t (api_key) VALUES ('vault:hrp-pik-dev/rti-creds:api-key');
    { "password": "vault:hrp-pik-dev/rti-creds:db-password" }

EXAMPLES
  # Apply secrets from default ~/.secrets_env to all matching config files
  ./updateConfigurationFiles.sh

  # Use a different env file
  ./updateConfigurationFiles.sh --env staging.env

  # Force Docker mode on Linux
  ./updateConfigurationFiles.sh --docker

  # Force local mode inside a container
  ./updateConfigurationFiles.sh --local

  # Use a custom config file
  ./updateConfigurationFiles.sh --config prod-config.yaml

  # Override container name (e.g. when running against a different instance)
  ./updateConfigurationFiles.sh --container payer-tc-262

─────────────────────────────────────────────────────────────────────
EOF
}

# ─── Argument parsing ─────────────────────────────────────────────────────────

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --env)
        if [[ -z "${2:-}" ]]; then
          echo "✖  --env requires a filename argument."
          exit 1
        fi
        OUTPUT_FILE="$2"
        ENV_FILE_EXPLICIT=1
        shift 2
        ;;
      --credentials)
        # Accept empty string gracefully — treated as "not provided", falls back to --env
        CREDENTIALS_STR="${2:-}"
        shift 2
        ;;
      --load-secrets-script)
        if [[ -z "${2:-}" ]]; then
          echo "✖  --load-secrets-script requires a file path."
          exit 1
        fi
        LOAD_SECRETS_SCRIPT="$2"
        shift 2
        ;;
      --load-secrets-wl-props)
        if [[ -z "${2:-}" ]]; then
          echo "✖  --load-secrets-wl-props requires a file path."
          exit 1
        fi
        LOAD_SECRETS_WL_PROPS="$2"
        shift 2
        ;;
      --config)
        if [[ -z "${2:-}" ]]; then
          echo "✖  --config requires a filename argument."
          exit 1
        fi
        CONFIG_FILE="$2"
        shift 2
        ;;
      --docker)
        USE_DOCKER="docker"
        shift
        ;;
      --local)
        USE_DOCKER="local"
        shift
        ;;
      --container)
        if [[ -z "${2:-}" ]]; then
          echo "✖  --container requires a container name argument."
          exit 1
        fi
        OVERRIDE_CONTAINER="$2"
        shift 2
        ;;
      --filePath)
        if [[ -z "${2:-}" ]]; then
          echo "✖  --filePath requires a file path argument."
          exit 1
        fi
        FILE_PATH="$2"
        shift 2
        ;;
      --folderPath)
        if [[ -z "${2:-}" ]]; then
          echo "✖  --folderPath requires a directory path argument."
          exit 1
        fi
        FOLDER_PATH="$2"
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

# ─── Helpers ──────────────────────────────────────────────────────────────────

# Resolve a vault reference from .secrets_env.
# Supports two formats:
#   vault:<secret-path>              — plain string secret
#   vault:<secret-path>:<json-field> — JSON object secret; extracts the named field
#
# Usage: resolve_vault_ref <env-file> <vault-ref>
#   vault-ref is the part after "vault:"
#   e.g. "hrp-payor-dev/artemis-creds:artemis-password"
# Prints the resolved plain-text value to stdout, or nothing if not found.
resolve_vault_ref() {
  local file="$1"
  local vault_ref="$2"

  local secret_path json_field
  if [[ "$vault_ref" == *":"* ]]; then
    secret_path="${vault_ref%%:*}"   # e.g. hrp-payor-dev/artemis-creds
    json_field="${vault_ref##*:}"    # e.g. artemis-password
  else
    secret_path="$vault_ref"
    json_field=""
  fi

  # Collect the full multi-line value from .secrets_env for this secret key.
  # Values span multiple lines and may have a trailing comma after the closing }":
  #   key="{
  #       \"field\":\"value\"
  #     }",        ← trailing comma on last field of non-final secret
  #   key="{
  #       \"field\":\"value\"
  #     }"         ← no comma on the final secret
  local raw="" collecting=0
  while IFS= read -r line; do
    line="${line%$'\r'}"   # strip Windows carriage return
    if [[ $collecting -eq 0 && "$line" == "${secret_path}="* ]]; then
      collecting=1
      raw="${line#*=}"
      # Single-line value — check for }" or }",
      [[ "$raw" =~ \}\"[,]?[[:space:]]*$ ]] && break
      continue
    fi
    if [[ $collecting -eq 1 ]]; then
      raw="${raw} ${line}"
      # Stop at closing }" or }", line
      [[ "$line" =~ ^[[:space:]]*\}\"[,]?[[:space:]]*$ ]] && break
    fi
  done < "$file"

  if [[ -z "$raw" ]]; then
    echo "  ⚠  Secret key \"$secret_path\" not found in $file" >&2
    return 1
  fi

  # Strip trailing comma if present: }"," -> }"
  raw="${raw%,}"
  raw="${raw% }"

  # Strip surrounding outer quotes: "{ ... }" -> { ... }
  local inner="${raw#\"}"
  inner="${inner%\"}"

  # Unescape \" -> "
  local unescaped="${inner//\\\"/\"}"

  # If no json field requested, return the plain value
  if [[ -z "$json_field" ]]; then
    echo "$unescaped"
    return 0
  fi

  # Extract the json field value using grep + sed — no jq required
  # Matches: "field-name":"value"  or  "field-name": "value"
  local extracted
  extracted=$(printf '%s' "$unescaped" \
    | grep -o "\"${json_field}\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" \
    | sed 's/.*":[[:space:]]*"\(.*\)"/\1/')

  if [[ -z "$extracted" ]]; then
    local available
    available=$(printf '%s' "$unescaped" | grep -o '"[^"]*"[[:space:]]*:' | tr -d ' :"' | tr '\n' ', ' | sed 's/,$//')
    echo "  ⚠  Field \"$json_field\" not found in secret \"$secret_path\". Available: $available" >&2
    return 1
  fi

  echo "$extracted"
}

# ─── Credentials string lookup ──────────────────────────────────────────────
# When --credentials "$CREDS" is passed (output of loadSecrets.sh), this
# function looks up a secret FIELD NAME in the credentials string.
# loadSecrets.sh outputs JSON field names as keys (e.g. oltp-password=hedge)
# so we match by the field extracted from the vault: reference, not the
# wl.properties property key name.
# Usage: lookup_in_credentials "<json-field>"  e.g. lookup_in_credentials "oltp-password"
# Returns the resolved value, or empty string if not found.
lookup_in_credentials() {
  local field_name="$1"
  [[ -z "${CREDENTIALS_STR:-}" ]] && return 0
  local line
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    local k v
    k="${line%%=*}"
    v="${line#*=}"
    if [[ "$k" == "$field_name" ]]; then
      # loadSecrets.sh emits raw (unquoted) values — print directly, no eval needed.
      printf '%s' "$v"
      return 0
    fi
  done <<< "${CREDENTIALS_STR:-}"
  return 0
}

# ─── Internal loadSecrets.sh call ───────────────────────────────────────────
# When --load-secrets-script is provided and --credentials is not set,
# call loadSecrets.sh to populate CREDENTIALS_STR internally.
load_credentials_internally() {
  [[ -n "${CREDENTIALS_STR:-}" ]] && return 0          # already loaded
  [[ -z "$LOAD_SECRETS_SCRIPT" ]] && return 0      # no script provided
  [[ ! -x "$LOAD_SECRETS_SCRIPT" ]] && {
    echo "  ⚠  --load-secrets-script not executable: $LOAD_SECRETS_SCRIPT" >&2
    return 1
  }
  local wl_props="${LOAD_SECRETS_WL_PROPS:-}"
  local args=()
  [[ -n "$wl_props" ]] && args+=(--wl-props "$wl_props")
  args+=(--secrets-env "$OUTPUT_FILE")
  echo "  ℹ  Calling loadSecrets.sh to resolve credentials internally..." >&2
  CREDENTIALS_STR=$("$LOAD_SECRETS_SCRIPT" "${args[@]}")
  echo "  ✔  Credentials loaded internally via loadSecrets.sh." >&2
}

# Replace a key=value line in-place in a properties-style file.
replace_value_in_file() {
  local file="$1"
  local key="$2"
  local value="$3"

  # Escape characters special in the sed replacement string
  local escaped_value
  escaped_value="${value//\\/\\\\}"  # \ → \\\\
  escaped_value="${escaped_value//&/\\&}"  # & → \&
  escaped_value="${escaped_value//|/\\|}"  # | → \|
  if grep -qE "^${key}\s*=" "$file" 2>/dev/null; then
    sed -i -E "s|^(${key}\s*=\s*).*|\1${escaped_value}|" "$file"
  else
    echo "${key}=${value}" >> "$file"
    echo "  ℹ  Key \"${key}\" not found in file — appended."
  fi
}

# ─── Detect file type ─────────────────────────────────────────────────────────
detect_file_type() {
  local file="${1%$'\r'}"   # strip any trailing carriage return
  local ext="${file##*.}"
  ext="${ext%$'\r'}"        # double-safety strip on extension itself
  case "$ext" in
    xml|jocl)     echo "xml"        ;;
    yaml|yml)     echo "yaml"       ;;
    sql|json|cfg|bat) echo "text"   ;;
    *)            echo "properties" ;;
  esac
}

# ─── XML helpers ──────────────────────────────────────────────────────────────
# Supports both vault patterns in XML:
#   1. In attributes: <string value="vault:<secret-path>:<json-field>"/>
#   2. In element content: <Password>vault:<secret-path>:<json-field></Password>

scan_vault_keys_xml() {
  local file="$1"
  # Pattern 1: value="vault:..."
  grep -oE 'value="[Vv][Aa][Uu][Ll][Tt]:([^"]+)"' "$file" 2>/dev/null \
    | sed -E 's/value="[Vv][Aa][Uu][Ll][Tt]:([^"]+)"/\1/'
  # Pattern 2: >vault:...< (inside XML tags)
  grep -oE '>[Vv][Aa][Uu][Ll][Tt]:([^<]+)<' "$file" 2>/dev/null \
    | sed -E 's/^>[Vv][Aa][Uu][Ll][Tt]://;s/<$//'
}

replace_vault_in_xml() {
  local file="$1"
  local vault_key="$2"
  local value="$3"

  local escaped_value
  escaped_value=$(printf '%s' "$value" | sed 's/[&\|]/\\&/g')
  # Replace in attributes: value="vault:..."
  sed -i -E "s|value=\"[Vv][Aa][Uu][Ll][Tt]:${vault_key}\"|value=\"${escaped_value}\"|g" "$file"
  # Replace in element content: >vault:...</
  sed -i -E "s|>[Vv][Aa][Uu][Ll][Tt]:${vault_key}<|>${escaped_value}<|g" "$file"
}

# ─── YAML helpers ────────────────────────────────────────────────────────────
#
#  Supported YAML vault: syntax (both plain and quoted values):
#    key: vault:<secret-path>:<json-field>
#    key: "vault:<secret-path>:<json-field>"
#
#  Examples:
#    datasource.password: vault:hrp-payor-dev/oltpds-creds:oltpds-password
#    artemis.password: "vault:hrp-payor-dev/artemis-creds:artemis-password"

scan_vault_keys_yaml() {
  local file="$1"
  # Match: key: vault:..., key: "vault:...", key: 'vault:...'
  # Returns the vault ref (the part after "vault:") for each matching line
  grep -iE ":[[:space:]]*['\"]?vault:" "$file" 2>/dev/null \
    | grep -oiE "['\"]?vault:([^'\"[:space:]]+)" \
    | sed -E "s/^['\"]?[Vv][Aa][Uu][Ll][Tt]://"
}

replace_vault_in_yaml() {
  local file="$1"
  local vault_ref="$2"
  local value="$3"

  # Strip CRLF first — Windows line endings break $ anchor in sed
  sed -i 's/\r$//' "$file"

  # Process line by line — avoids all sed quoting/escaping issues with
  # special characters in vault_ref (/, :) and value ({AES}..., =, etc.)
  local tmp
  tmp=$(mktemp /tmp/yaml-replace-XXXXXX)

  while IFS= read -r line; do
    # Check if this line contains vault:<ref> in either quoted or unquoted form
    if printf '%s' "$line" | grep -qiF "vault:${vault_ref}"; then
      # Unquoted:  key: vault:<ref>  ->  key: <value>
      # Quoted  :  key: "vault:<ref>"  ->  key: "<value>"
      local indent key_part quote_char=""
      # Detect if value is quoted in the yaml
      if printf '%s' "$line" | grep -qF "\"vault:${vault_ref}\""; then
        quote_char='"'
      fi
      # Replace the vault ref with the actual value, preserving indentation and key
      if [[ -n "$quote_char" ]]; then
        line=$(printf '%s' "$line" | sed "s|\"vault:${vault_ref}\"|\"${value}\"|g")
      else
        line=$(printf '%s' "$line" | sed "s|vault:${vault_ref}|${value}|g")
      fi
    fi
    printf '%s\n' "$line"
  done < "$file" > "$tmp"

  mv "$tmp" "$file"
}

# ─── Text file helpers (.sql, .json, .cfg, .bat) ─────────────────────────────
#
#  Replaces bare vault: references that appear anywhere in the file content —
#  e.g. inside SQL string literals or JSON values — using plain-text substitution.
#
#  Supported syntax (case-insensitive):
#    vault:<secret-path>:<json-field>
#
#  Examples:
#    INSERT INTO customer (api_key) VALUES ('vault:hrp-pik-dev/creds:api-key');
#    { "password": "vault:hrp-pik-dev/creds:db-password" }

scan_vault_keys_text() {
  local file="$1"
  grep -oiE '[Vv][Aa][Uu][Ll][Tt]:[^[:space:]"'"'"'`,;)]+' "$file" 2>/dev/null \
    | sed -E 's/^[Vv][Aa][Uu][Ll][Tt]://'
}

replace_vault_in_text() {
  local file="$1"
  local vault_ref="$2"
  local value="$3"

  # Strip CRLF first
  sed -i 's/\r$//' "$file"

  local tmp
  tmp=$(mktemp /tmp/text-replace-XXXXXX)

  while IFS= read -r line; do
    if printf '%s' "$line" | grep -qiF "vault:${vault_ref}"; then
      line=$(printf '%s' "$line" | sed "s|[Vv][Aa][Uu][Ll][Tt]:${vault_ref}|${value}|g")
    fi
    printf '%s\n' "$line"
  done < "$file" > "$tmp"

  mv "$tmp" "$file"
}

# ─── OS-aware target filter ───────────────────────────────────────────────────
# Accepts a target type string ("docker", "local", "vm").
# Returns 0 (process) or 1 (skip) based on OS / --docker / --local flag.
should_process_target() {
  local target_type="$1"

  local effective_mode="${USE_DOCKER:-}"
  if [[ -z "$effective_mode" ]]; then
    [[ "$OS_TYPE" == "windows" || "$OS_TYPE" == "mac" ]] && effective_mode="docker" || effective_mode="local"
  fi

  if [[ "$effective_mode" == "docker" && "$target_type" == "docker" ]]; then
    return 0
  elif [[ "$effective_mode" == "local" && ( "$target_type" == "local" || "$target_type" == "vm" ) ]]; then
    return 0
  else
    return 1
  fi
}

# ─── Path expansion ─────────────────────────────────────────────────────────────────────────────────
expand_path() {
  local path="$1"
  # Replace leading ~ with $HOME before eval
  # Tilde is not expanded inside double quotes by bash
  path="${path/#\~/$HOME}"
  eval "printf '%s' \"$path\""
}

# ─── Docker file helpers ──────────────────────────────────────────────────────

docker_pull_file() {
  local container="$1"
  local container_path="$2"
  local local_dest="$3"
  docker cp "${container}:${container_path}" "$local_dest" 2>&1
}

docker_push_file() {
  local container="$1"
  local local_src="$2"
  local container_path="$3"
  local user="$4"

  if ! docker cp "$local_src" "${container}:${container_path}" 2>&1; then
    return 1
  fi

  local safe_path
  if [ "$(uname -o 2>/dev/null)" = "Msys" ]; then
    safe_path="/${container_path}"
  else
    safe_path="${container_path}"
  fi

  docker exec --user root "$container" chown "${user}:${user}" "$safe_path" 2>&1 || true
}

# ─── process_target_file ──────────────────────────────────────────────────────
# Given a resolved local path to a (possibly temp-copied) config file,
# scans for vault: references and replaces them from .secrets_env.
# Returns the count of keys mapped via stdout-captured caller pattern.
process_target_file() {
  local to_file="$1"
  local original_path="$2"
  local from_file="$3"
  local mapped=0
  local skipped=0

  # Normalise line endings (safety for files edited on Windows)
  if command -v dos2unix &>/dev/null; then
    dos2unix "$to_file" 2>/dev/null
  else
    sed -i 's/\r$//' "$to_file"
  fi

  local file_type
  file_type=$(detect_file_type "$original_path")

  if [[ "$file_type" == "xml" ]]; then
    # ── XML / JOCL ────────────────────────────────────────────────────────────
    # scan_vault_keys_xml returns the full ref after "vault:" including :field
    while IFS= read -r vault_ref; do
      [[ -z "$vault_ref" ]] && continue
      local value
      value=$(resolve_vault_ref "$from_file" "$vault_ref")
      if [[ -z "$value" ]]; then
        echo "  ⚠  vault:$vault_ref — could not resolve from $from_file — skipping."
        skipped=$((skipped + 1))
        continue
      fi
      replace_vault_in_xml "$to_file" "$vault_ref" "$value"
      echo "  ✔  <string value=\"vault:$vault_ref\"> → resolved"
      mapped=$((mapped + 1))
    done < <(scan_vault_keys_xml "$to_file")

  elif [[ "$file_type" == "yaml" ]]; then
    # ── YAML ──────────────────────────────────────────────────────────────────
    while IFS= read -r vault_ref; do
      [[ -z "$vault_ref" ]] && continue
      local value
      value=$(resolve_vault_ref "$from_file" "$vault_ref")
      if [[ -z "$value" ]]; then
        echo "  ⚠  vault:$vault_ref — could not resolve from $from_file — skipping."
        skipped=$((skipped + 1))
        continue
      fi
      replace_vault_in_yaml "$to_file" "$vault_ref" "$value"
      echo "  ✔  vault:$vault_ref → resolved"
      mapped=$((mapped + 1))
    done < <(scan_vault_keys_yaml "$to_file")

  elif [[ "$file_type" == "text" ]]; then
    # ── SQL / JSON / CFG / BAT — plain-text vault: substitution ──────────────
    while IFS= read -r vault_ref; do
      [[ -z "$vault_ref" ]] && continue
      local value
      value=$(resolve_vault_ref "$from_file" "$vault_ref")
      if [[ -z "$value" ]]; then
        echo "  ⚠  vault:$vault_ref — could not resolve from $from_file — skipping."
        skipped=$((skipped + 1))
        continue
      fi
      replace_vault_in_text "$to_file" "$vault_ref" "$value"
      echo "  ✔  vault:$vault_ref → resolved"
      mapped=$((mapped + 1))
    done < <(scan_vault_keys_text "$to_file")

  else
    # ── Properties / flat file ────────────────────────────────────────────────
    while IFS= read -r raw_line; do
      [[ "$raw_line" =~ ^# ]] && continue
      [[ "$raw_line" =~ ^\[ ]] && continue
      [[ -z "${raw_line// }" ]] && continue

      local target_key target_value
      target_key="${raw_line%%=*}"
      target_value="${raw_line#*=}"
      # trim whitespace
      target_key="${target_key#"${target_key%%[! ]*}"}"; target_key="${target_key%"${target_key##*[! ]}"}"
      target_value="${target_value#"${target_value%%[! ]*}"}"; target_value="${target_value%"${target_value##*[! ]}"}"
      [[ -z "$target_key" ]] && continue

      # Match vault:<secret-path> or vault:<secret-path>:<json-field>
      if [[ ! "$target_value" =~ ^[Vv][Aa][Uu][Ll][Tt]:(.+)$ ]]; then
        skipped=$((skipped + 1))
        continue
      fi

      local vault_ref="${BASH_REMATCH[1]}"
      vault_ref="${vault_ref%$'\r'}"         # strip carriage return (CRLF files)
      vault_ref="${vault_ref%"${vault_ref##*[! ]}"}"  # trim trailing whitespace

      local value
      # Extract the JSON field name from the vault ref (e.g. "oltp-password" from
      # "hrp-payor-dev/payor-creds:oltp-password"). loadSecrets.sh outputs fields
      # as keys in CREDENTIALS_STR so we look up by field name, not wl.properties key.
      local json_field_name="${vault_ref##*:}"
      value=$(lookup_in_credentials "$json_field_name")
      if [[ -z "$value" ]]; then
        # Fall back to .secrets_env file-based resolution
        value=$(resolve_vault_ref "$from_file" "$vault_ref")
      fi
      if [[ -z "$value" ]]; then
        echo "  ⚠  vault:$vault_ref — could not resolve for $target_key — skipping."
        skipped=$((skipped + 1))
        continue
      fi

      replace_value_in_file "$to_file" "$target_key" "$value"
      echo "  ✔  $target_key = vault:$vault_ref → resolved"
      mapped=$((mapped + 1))

    done < <(grep -v '^#' "$to_file")
  fi
  echo "  ─  $mapped updated, $skipped keys had no vault: reference"
  # Return mapped count for total tally
  echo "__MAPPED__:${mapped}"
}

# ─── Pure bash YAML config parser ────────────────────────────────────────────
# Parses the configuration YAML file without requiring jq or python.
# Supports .yaml and .yml extensions.
# Expected format:
#   source: ~/.secrets_env
#   targets:
#     - type: docker
#       user: weblogic
#       container: payer-tc-261
#       path: $DOMAIN_HOME/runtime.properties
#     - type: local
#       path: $DOMAIN_HOME/runtime.properties
#
# Populates global arrays:
#   YAML_SOURCE        — the source env file path
#   YAML_TYPES[]       — target type per index
#   YAML_PATHS[]       — target path per index
#   YAML_USERS[]       — target user per index (docker/vm)
#   YAML_CONTAINERS[]  — target container per index (docker)
#   YAML_HOSTS[]       — target host per index (vm)
#   YAML_TARGET_COUNT  — number of targets

YAML_SOURCE=""
YAML_TYPES=()
YAML_PATHS=()
YAML_USERS=()
YAML_CONTAINERS=()
YAML_HOSTS=()
YAML_TARGET_COUNT=0

parse_config_yaml() {
  local file="$1"
  YAML_SOURCE=""
  YAML_TYPES=()
  YAML_PATHS=()
  YAML_USERS=()
  YAML_CONTAINERS=()
  YAML_HOSTS=()
  YAML_TARGET_COUNT=0

  local idx=-1
  local in_targets=0

  while IFS= read -r line; do
    # Strip carriage return and trailing whitespace
    line="${line%$'\r'}"
    line="${line%"${line##*[! ]}"}"

    # Skip blank lines and comments
    [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue

    # Strip leading whitespace for key detection
    local stripped="${line#"${line%%[! ]*}"}"

    # top-level source:
    if [[ "$stripped" =~ ^source:[[:space:]]*(.+)$ ]]; then
      YAML_SOURCE="${BASH_REMATCH[1]}"
      YAML_SOURCE="${YAML_SOURCE%"${YAML_SOURCE##*[! ]}"}"
      continue
    fi

    # targets: marker
    if [[ "$stripped" =~ ^targets:[[:space:]]*$ ]]; then
      in_targets=1
      continue
    fi

    [[ $in_targets -eq 0 ]] && continue

    # New target entry: starts with "- type:" or "- " with any key
    if [[ "$stripped" =~ ^-[[:space:]]+type:[[:space:]]*(.+)$ ]]; then
      idx=$((idx + 1))
      YAML_TYPES[$idx]="${BASH_REMATCH[1]}"
      YAML_TYPES[$idx]="${YAML_TYPES[$idx]%"${YAML_TYPES[$idx]##*[! ]}"}"
      YAML_PATHS[$idx]=""
      YAML_USERS[$idx]=""
      YAML_CONTAINERS[$idx]=""
      YAML_HOSTS[$idx]=""
      continue
    fi

    # Continuation keys inside a target block
    if [[ $idx -ge 0 ]]; then
      if [[ "$stripped" =~ ^type:[[:space:]]*(.+)$ ]]; then
        YAML_TYPES[$idx]="${BASH_REMATCH[1]%"${BASH_REMATCH[1]##*[! ]}"}"
      elif [[ "$stripped" =~ ^path:[[:space:]]*(.+)$ ]]; then
        YAML_PATHS[$idx]="${BASH_REMATCH[1]%"${BASH_REMATCH[1]##*[! ]}"}"
      elif [[ "$stripped" =~ ^user:[[:space:]]*(.+)$ ]]; then
        YAML_USERS[$idx]="${BASH_REMATCH[1]%"${BASH_REMATCH[1]##*[! ]}"}"
      elif [[ "$stripped" =~ ^container:[[:space:]]*(.+)$ ]]; then
        YAML_CONTAINERS[$idx]="${BASH_REMATCH[1]%"${BASH_REMATCH[1]##*[! ]}"}"
      elif [[ "$stripped" =~ ^host:[[:space:]]*(.+)$ ]]; then
        YAML_HOSTS[$idx]="${BASH_REMATCH[1]%"${BASH_REMATCH[1]##*[! ]}"}"
      fi
    fi
  done < "$file"

  YAML_TARGET_COUNT=$((idx + 1))
}

# ─── resolve_secrets_source ──────────────────────────────────────────────────
# Determines which secrets file to use as the source for vault: lookups.
#
# Priority (highest → lowest):
#   1. YAML source:          — explicit path declared in payor_configuration_file_path.yaml
#   2. --env <file>          — explicit command-line override (ENV_FILE_EXPLICIT=1)
#   3. ~/.secrets_path       — auto-discovered; home directory takes precedence
#   4. ./.secrets_path       — auto-discovered; current working directory
#   5. ~/.secrets_env        — hardcoded default (OUTPUT_FILE)
#
# Prints the resolved path to stdout.
# Note: --credentials (in-memory) bypasses file lookup entirely; callers check
#       CREDENTIALS_STR before calling this function.
resolve_secrets_source() {
  local yaml_source="${1:-}"   # YAML_SOURCE value (may be empty)

  # 1. Explicit YAML source:
  if [[ -n "$yaml_source" ]]; then
    expand_path "$yaml_source"
    return
  fi

  # 2. Explicit --env override
  if [[ "$ENV_FILE_EXPLICIT" -eq 1 ]]; then
    expand_path "$OUTPUT_FILE"
    return
  fi

  # 3. ~/.secrets_path — home directory (takes precedence over current dir)
  if [[ -f "$HOME/.secrets_path" ]]; then
    echo "$HOME/.secrets_path"
    return
  fi

  # 4. ./.secrets_path — current working directory
  if [[ -f "./.secrets_path" ]]; then
    echo "./.secrets_path"
    return
  fi

  # 5. Default fallback
  expand_path "$OUTPUT_FILE"
}

# ─── apply_config_mappings ────────────────────────────────────────────────────
# Parses configuration YAML file (no jq needed), iterates each target entry,
# resolves the file (local / Docker / VM), and applies vault: substitutions.
apply_config_mappings() {
  # ── CONFIG_FILE check ────────────────────────────────────────────────────────
  # When --filePath or --folderPath is provided the YAML config is not required;
  # skip the existence check so the script works without a config file in those modes.
  if [[ -z "${FILE_PATH:-}" && -z "${FOLDER_PATH:-}" ]]; then
    if [[ ! -f "$CONFIG_FILE" ]]; then
      echo "  ⚠  Config file \"$CONFIG_FILE\" not found — nothing to update."
      echo ""
      return
    fi
  fi

  echo "─────────────────────────────────────────"
  if [[ -n "${FILE_PATH:-}" ]]; then
    echo "  Applying to single file (--filePath) …"
  elif [[ -n "${FOLDER_PATH:-}" ]]; then
    echo "  Applying to all resource files under (--folderPath) …"
  else
    echo "  Applying config from $CONFIG_FILE …"
  fi
  echo "─────────────────────────────────────────"
  echo ""

  # Parse the YAML config file only when it exists — needed for YAML_SOURCE.
  # In --filePath mode the config file is optional; still parse it if present
  # so that a source: line inside it is honoured for secret resolution.
  if [[ -f "$CONFIG_FILE" ]]; then
    parse_config_yaml "$CONFIG_FILE"
  fi

  # If --load-secrets-script provided and --credentials not set, load internally
  load_credentials_internally

  # Determine source env file.
  # Full priority: --credentials > YAML source: > --env > ~/.secrets_path > ./.secrets_path > ~/.secrets_env
  # resolve_secrets_source() encodes steps 2-5; --credentials is handled separately below.
  local from_file
  from_file=$(resolve_secrets_source "${YAML_SOURCE:-}")

  if [[ -n "${CREDENTIALS_STR:-}" ]]; then
    echo "  ℹ  Using pre-resolved credentials (passed via --credentials)"
  else
    # Log which source was auto-selected so the operator can see the resolution
    if [[ -z "${YAML_SOURCE:-}" && "$ENV_FILE_EXPLICIT" -eq 0 ]]; then
      if [[ "$from_file" == "$HOME/.secrets_path" ]]; then
        echo "  ℹ  Source resolved: ~/.secrets_path (home directory)"
      elif [[ "$from_file" == "$(pwd)/.secrets_path" || "$from_file" == "./.secrets_path" ]]; then
        echo "  ℹ  Source resolved: ./.secrets_path (current directory)"
      fi
    fi
  fi

  if [[ ! -f "$from_file" ]]; then
    echo "  ✖  Source env file \"$from_file\" not found."
    if [[ "$from_file" == *"/staging/"* || "$from_file" == *"/home/weblogic"* ]]; then
      echo "     Running inside Docker container."
      echo "     Ensure deployPayorTomcat.sh copies ~/.secrets_env to the container staging directory."
    else
      echo "     Run fetchAWSSecrets.sh first to populate ~/.secrets_env."
    fi
    echo ""
    exit 1
  fi

  # ── --filePath mode: process a single local file, skip YAML target loop ─────
  if [[ -n "${FILE_PATH:-}" ]]; then
    local resolved_path
    resolved_path=$(expand_path "$FILE_PATH")

    echo "  ──────────────────────────────────────"
    echo "  Source : $from_file"
    echo "  Type   : local (--filePath override)"
    echo "  Path   : $resolved_path"

    if [[ ! -f "$resolved_path" ]]; then
      echo "  ✖  Target file \"$resolved_path\" not found — aborting."
      echo ""
      exit 1
    fi

    local file_type_check
    file_type_check=$(detect_file_type "$resolved_path")
    echo "  File type: $file_type_check (original_path: $resolved_path)"
    echo "  Secrets  : $from_file (exists: $([ -f "$from_file" ] && echo yes || echo NO))"
    echo "  Vault refs found:"
    grep -v '^#' "$resolved_path" | grep -iE '^[A-Z_]+=vault:' | sed 's/^/    /' || echo "    (none found)"

    local output mapped_line
    output=$(process_target_file "$resolved_path" "$resolved_path" "$from_file")
    echo "$output" | grep -v "^__MAPPED__:"
    mapped_line=$(echo "$output" | grep "^__MAPPED__:" | tail -1)
    local mapped="${mapped_line#__MAPPED__:}"

    echo ""
    echo "  ✔  Total: ${mapped:-0} key(s) updated in $resolved_path"
    echo "─────────────────────────────────────────"
    echo ""
    return
  fi

  # ── --folderPath mode: scan folder for supported file types, process each ────
  if [[ -n "${FOLDER_PATH:-}" ]]; then
    local resolved_folder
    resolved_folder=$(expand_path "$FOLDER_PATH")

    if [[ ! -d "$resolved_folder" ]]; then
      echo "  ✖  Folder \"$resolved_folder\" not found — aborting."
      echo ""
      exit 1
    fi

    local resource_files=()
    while IFS= read -r f; do
      resource_files+=("$f")
    done < <(find "$resolved_folder" \( -name "*.sql" -o -name "*.properties" -o -name "*.yaml" -o -name "*.yml" -o -name "*.cfg" -o -name "*.json" -o -name "*.bat" \) | sort)

    if [[ ${#resource_files[@]} -eq 0 ]]; then
      echo "  ℹ  No supported resource files found under $resolved_folder — nothing to update."
      echo "─────────────────────────────────────────"
      echo ""
      return
    fi

    local total_mapped=0
    for resource_file in "${resource_files[@]}"; do
      echo "  ──────────────────────────────────────"
      echo "  Source : $from_file"
      echo "  Type   : local (--folderPath)"
      echo "  Path   : $resource_file"

      local file_type_check
      file_type_check=$(detect_file_type "$resource_file")
      echo "  File type: $file_type_check"

      local output mapped_line
      output=$(process_target_file "$resource_file" "$resource_file" "$from_file")
      echo "$output" | grep -v "^__MAPPED__:"
      mapped_line=$(echo "$output" | grep "^__MAPPED__:" | tail -1)
      local mapped="${mapped_line#__MAPPED__:}"
      total_mapped=$((total_mapped + ${mapped:-0}))
      echo ""
    done

    echo "  ✔  Total: $total_mapped key(s) updated across ${#resource_files[@]} file(s) under $resolved_folder"
    echo "─────────────────────────────────────────"
    echo ""
    return
  fi

  # ── Normal mode: iterate targets from YAML config ───────────────────────────
  local total_mapped=0
  local target_count="$YAML_TARGET_COUNT"

  for (( i=0; i<target_count; i++ )); do
    local target_type="${YAML_TYPES[$i]}"

    # Skip targets that don't match current OS / --docker / --local mode
    if ! should_process_target "$target_type"; then
      continue
    fi

    local raw_path="${YAML_PATHS[$i]}"
    raw_path="${raw_path%$'\r'}"

    echo "  ──────────────────────────────────────"
    echo "  Source : $from_file"
    echo "  Type   : $target_type"
    echo "  Path   : $raw_path"

    local to_file=""
    local original_path=""
    local tmp_file=""
    local is_docker=0
    local is_vm=0

    if [[ "$target_type" == "docker" ]]; then
      # ── Docker target ────────────────────────────────────────────────────────
      is_docker=1
      local docker_user docker_container
      docker_user="${YAML_USERS[$i]}"
      local json_container="${YAML_CONTAINERS[$i]}"
      # --container flag overrides the value from config file
      docker_container="${OVERRIDE_CONTAINER:-$json_container}"

      if ! docker inspect --format '{{.State.Running}}' "$docker_container" 2>/dev/null | grep -q true; then
        echo "  ✖  Container \"$docker_container\" is not running — skipping."
        echo ""
        continue
      fi

      # Resolve env vars inside the container as the target user
      local docker_container_path
      docker_container_path=$(docker exec --user "$docker_user" "$docker_container" \
        bash -c "echo \"$raw_path\"" 2>/dev/null | tr -d '\r')

      if [[ -z "$docker_container_path" ]]; then
        echo "  ✖  Could not resolve \"$raw_path\" inside container — skipping."
        echo ""
        continue
      fi
      echo "           (resolved inside container: $docker_container_path)"
      original_path="$docker_container_path"

      tmp_file=$(mktemp /tmp/update-config-XXXXXX)
      echo "  ↓  Pulling [$docker_container]:$docker_container_path …"
      if ! docker_pull_file "$docker_container" "$docker_container_path" "$tmp_file"; then
        echo "  ✖  Could not pull file from container — skipping."
        rm -f "$tmp_file"
        echo ""
        continue
      fi
      to_file="$tmp_file"

    elif [[ "$target_type" == "vm" ]]; then
      # ── VM target (SSH/SCP) ──────────────────────────────────────────────────
      is_vm=1
      local vm_user vm_host
      vm_user="${YAML_USERS[$i]}"
      vm_host="${YAML_HOSTS[$i]}"

      # Resolve env vars on the remote VM
      local vm_path
      vm_path=$(ssh -o BatchMode=yes -o ConnectTimeout=5 "${vm_user}@${vm_host}" \
        "echo \"$raw_path\"" 2>/dev/null | tr -d '\r')

      if [[ -z "$vm_path" ]]; then
        echo "  ✖  Could not resolve path on VM ${vm_host} — skipping."
        echo ""
        continue
      fi
      echo "           (resolved on VM: $vm_path)"
      original_path="$vm_path"

      tmp_file=$(mktemp /tmp/update-config-XXXXXX)
      echo "  ↓  Pulling ${vm_user}@${vm_host}:${vm_path} …"
      if ! scp -o BatchMode=yes -o ConnectTimeout=5 \
          "${vm_user}@${vm_host}:${vm_path}" "$tmp_file" 2>/dev/null; then
        echo "  ✖  Could not pull file from VM — skipping."
        rm -f "$tmp_file"
        echo ""
        continue
      fi
      to_file="$tmp_file"

    else
      # ── Local file target ────────────────────────────────────────────────────
      to_file=$(expand_path "${raw_path%$'\r'}")
      original_path="$to_file"
      if [[ ! -f "$to_file" ]]; then
        echo "  ⚠  Target file \"$to_file\" not found — skipping."
        echo ""
        continue
      fi
    fi

    # ── Process the file (scan & replace vault: references) ───────────────────
    local file_type_check
    file_type_check=$(detect_file_type "$original_path")
    echo "  File type: $file_type_check (original_path: $original_path)"
    echo "  Secrets  : $from_file (exists: $([ -f "$from_file" ] && echo yes || echo NO))"
    echo "  Vault refs found:"
    grep -v '^#' "$to_file" | grep -iE '^[A-Z_]+=vault:' | sed 's/^/    /' || echo "    (none found)"
    local output mapped_line
    output=$(process_target_file "$to_file" "$original_path" "$from_file")
    echo "$output" | grep -v "^__MAPPED__:"
    mapped_line=$(echo "$output" | grep "^__MAPPED__:" | tail -1)
    local mapped="${mapped_line#__MAPPED__:}"
    total_mapped=$((total_mapped + mapped))

    # ── Push back to Docker / VM ───────────────────────────────────────────────
    if [[ $is_docker -eq 1 && -n "$tmp_file" ]]; then
      if command -v dos2unix &>/dev/null; then
        dos2unix "$tmp_file" 2>/dev/null
      else
        sed -i 's/\r$//' "$tmp_file"
      fi
      echo "  ↑  Pushing updated file → [${docker_container}]:${docker_container_path}"
      if docker_push_file "$docker_container" "$tmp_file" "$docker_container_path" "$docker_user"; then
        echo "  ✔  Pushed. Ownership set to ${docker_user}:${docker_user}."
      else
        echo "  ✖  Failed to push file back to container."
      fi
      rm -f "$tmp_file"

    elif [[ $is_vm -eq 1 && -n "$tmp_file" ]]; then
      echo "  ↑  Pushing updated file → ${vm_user}@${vm_host}:${vm_path}"
      if scp -o BatchMode=yes -o ConnectTimeout=5 \
          "$tmp_file" "${vm_user}@${vm_host}:${vm_path}" 2>/dev/null; then
        echo "  ✔  Pushed successfully."
      else
        echo "  ✖  Failed to push file back to VM."
      fi
      rm -f "$tmp_file"
    fi

    echo ""
  done

  echo "  ✔  Total: $total_mapped key(s) updated across all target files"
  echo "─────────────────────────────────────────"
  echo ""
}


# ─── Main ─────────────────────────────────────────────────────────────────────

main() {
  parse_args "$@"

  echo "─────────────────────────────────────────"
  echo "  updateConfigurationFiles.sh"
  echo "─────────────────────────────────────────"
  echo "  Env file : $OUTPUT_FILE"
  [[ -n "${CREDENTIALS_STR:-}" ]] && echo "  Credentials: passed in-memory via --credentials (✔ .secrets_env will not be re-read)"
  [[ -n "${LOAD_SECRETS_SCRIPT:-}" && -z "${CREDENTIALS_STR:-}" ]] && echo "  loadSecrets : ${LOAD_SECRETS_SCRIPT:-} (will be called internally)"
  if [[ -z "${CREDENTIALS_STR:-}" && "$ENV_FILE_EXPLICIT" -eq 0 ]]; then
    if   [[ -f "$HOME/.secrets_path"  ]]; then echo "  SecretsFile: ~/.secrets_path (home — takes precedence)"
    elif [[ -f "./.secrets_path"      ]]; then echo "  SecretsFile: ./.secrets_path (current directory)"
    else                                        echo "  SecretsFile: ~/.secrets_env (default)"
    fi
  fi
  echo "  Config   : $CONFIG_FILE"
  echo "  OS       : $OS_TYPE"
  local _mode="${USE_DOCKER:-}"
  if [[ -z "$_mode" ]]; then
    [[ "$OS_TYPE" == "windows" || "$OS_TYPE" == "mac" ]] && _mode="docker" || _mode="local"
    _mode="${_mode} (auto from OS: ${OS_TYPE})"
  fi
  echo "  Mode     : $_mode"
  [[ -n "$OVERRIDE_CONTAINER" ]] && echo "  Container : $OVERRIDE_CONTAINER (override)"
  [[ -n "$FILE_PATH"          ]] && echo "  FilePath  : $FILE_PATH (--filePath override — YAML targets will be skipped)"
  [[ -n "$FOLDER_PATH"        ]] && echo "  FolderPath: $FOLDER_PATH (--folderPath override — YAML targets will be skipped)"
  echo ""

  apply_config_mappings
}

main "$@"
