# Copyright © 2001-2026 HealthEdge Software, Inc. All Rights Reserved.
#
# This software is proprietary information of HealthEdge Software, Inc.
# and may not be reproduced or redistributed for any purpose.
#
# Shared secrets-handling functions for the payor install flow. Sourced by
# installit so a standalone `installit` run injects secrets the same way a
# refresh-payor-driven install does.
#
# Expects DEV_TOOLS_HOME, WL_DOMAIN and DOMAIN_HOME to already be set in the
# environment.

# ---------------------------------------------------------------------------
# exportSecretsForInstall
#   Export DB passwords from .secrets_env as env vars before install.
#   installCommon-tomcat.bash writes OLTP_PASSWORD and DW_PASSWORD into the
#   jocl files during install — those files are never overwritten later, so
#   the values must be correct at install time. All other credentials go to
#   runtime.properties and are handled by updateConfigurationFiles.sh
#   post-install (see inject_runtime_secrets below).
# ---------------------------------------------------------------------------
function exportSecretsForInstall() {
    local secrets_env="$HOME/.secrets_env"
    local load_secrets="$DEV_TOOLS_HOME/secrets_management/loadSecrets.sh"
    [[ -f "$secrets_env" && -x "$load_secrets" ]] || return 0

    local creds
    creds=$("$load_secrets" --secrets-env "$secrets_env" 2>/dev/null) || return 0

    # loadSecrets.sh emits raw key=value lines (printf '%s') — assign directly,
    # no eval or shell unquoting needed.
    local oltp_line dw_line
    oltp_line=$(grep -m1 '^oltp-password=' <<< "$creds" || true)
    dw_line=$(  grep -m1 '^dw-password='   <<< "$creds" || true)
    if [[ -n "$oltp_line" ]]; then
        local _v="${oltp_line#*=}"
        [[ -n "$_v" ]] && export OLTP_PASSWORD="$_v"
    fi
    if [[ -n "$dw_line" ]]; then
        local _v="${dw_line#*=}"
        [[ -n "$_v" ]] && export DW_PASSWORD="$_v"
    fi
}

# ---------------------------------------------------------------------------
# sync_secrets_targets
#   Everything - paths, config, logic - lives in this one function.
#   1. Resolves input file paths (args > env vars > defaults)
#   2. Validates both files exist
#   3. Extracts payor2, payor3, ... LISTEN_ADDRESS IPs from the override
#      file (the base "[payor]" entry, with no number, is excluded)
#   4. For each IP not already present as a "host:" in the yaml, appends a
#      "type: vm" target block pointing at runtime.properties, plus a second
#      "type: vm" target block for the same host pointing at
#      tools/runtime.properties.
# ---------------------------------------------------------------------------
sync_secrets_targets() {
  # --- variables declared directly inside the function ---
  local override_file="${1:-${WL_OVERRIDE_FILE:-$HOME/environments/$WL_DOMAIN/wl.properties.override}}"
  local yaml_file="${2:-${PAYOR_CFG_YAML_TMP:-${PAYOR_CONFIG_FILE:-$DEV_TOOLS_HOME/secrets_management/payor_configuration_file_path.yaml}}}"
  # Primary runtime.properties path under the domain home.
  local runtime_props_path="$DOMAIN_HOME/runtime.properties"
  # Additional runtime.properties path under the domain's tools directory.
  # This is appended as a second target block alongside the primary path above.
  local runtime_props_tools_path="$DOMAIN_HOME/tools/runtime.properties"
  local vm_user="weblogic"
  local pairs name ip

  echo "wl.properties.override : $override_file"
  echo "payor_configuration_file_path.yaml : $yaml_file"
  echo

  if [[ ! -f "$override_file" ]]; then
    echo "ERROR: wl.properties.override not found at: $override_file" >&2
    return 1
  fi

  if [[ ! -f "$yaml_file" ]]; then
    echo "ERROR: payor_configuration_file_path.yaml not found at: $yaml_file" >&2
    return 1
  fi

  pairs="$(grep -oP '^\[payor[0-9]+\]LISTEN_ADDRESS=\K[0-9.]+' "$override_file" \
    | nl -ba -w1 -s' ' \
    | awk '{print "payor"($1+1), $2}')"

  if [[ -z "$pairs" ]]; then
    echo "No payor2+ LISTEN_ADDRESS entries found in $override_file"
    return 0
  fi

  echo "Found payor host(s):"
  echo "$pairs" | sed 's/^/  /'

  # Trim any pre-existing trailing blank line(s) so new entries append
  # immediately after the last real content line, not after stray blanks.
  sed -i -e :a -e '/^[[:space:]]*$/{$d;N;ba' -e '}' "$yaml_file"

  while read -r name ip; do
    [[ -z "$ip" ]] && continue

    # Check/append both the primary runtime.properties path and the
    # tools/runtime.properties path independently for this host. Matching
    # is done strictly on type=vm + host + path together, so an existing
    # entry for one path doesn't block the other from being added.
    for target_path in "$runtime_props_path" "$runtime_props_tools_path"; do
      matched_vm_target="$(awk -v ip="$ip" -v path="$target_path" '
        {
          lines[NR] = $0
          if ($0 ~ /^[[:space:]]*-[[:space:]]*type:/) {
            last_type_val = $0
            sub(/^[[:space:]]*-[[:space:]]*type:[[:space:]]*/, "", last_type_val)
            gsub(/[[:space:]]+$/, "", last_type_val)
            host_matched = 0
          }
          if ($0 ~ "^[[:space:]]*host:[[:space:]]*" ip "[[:space:]]*$") {
            host_matched = 1
          }
          if (host_matched && $0 ~ "^[[:space:]]*path:[[:space:]]*" path "[[:space:]]*$") {
            if (last_type_val == "vm") found=1
          }
        }
        END { if (found) print "yes"; else print "no" }
      ' "$yaml_file")"

      if [[ "$matched_vm_target" == "yes" ]]; then
        echo "Target already present for ${name} (${ip}) -> ${target_path} with type vm: nothing to update in ${yaml_file}"
        continue
      fi

      echo "Adding vm target for ${name} (${ip}) -> ${target_path}"
      cat >> "$yaml_file" <<EOF
  - type: vm
    user: ${vm_user}
    host: ${ip}
    path: ${target_path}
EOF
    done
  done <<< "$pairs"

  # Cleanup: only trim trailing blank line(s) at the very end of the file.
  # Existing blank lines elsewhere in the file are left untouched.
  sed -i -e :a -e '/^[[:space:]]*$/{$d;N;ba' -e '}' "$yaml_file"

  echo "Done. Updated: $yaml_file"
  echo
  echo "----- Contents of $yaml_file -----"
  cat "$yaml_file"
  echo "-----------------------------------"
}

# ---------------------------------------------------------------------------
# inject_runtime_secrets
#   Resolve vault: refs in runtime.properties from .secrets_env.
#   installCommon-tomcat.bash writes vault: placeholders into
#   runtime.properties for any credential absent from wl.properties; this
#   resolves them post-install. Run this only after a successful install.
# ---------------------------------------------------------------------------
function inject_runtime_secrets() {
    local UPDATE_CFG_FILES="$DEV_TOOLS_HOME/secrets_management/updateConfigurationFiles.sh"
    local PAYOR_CFG_YAML="$DEV_TOOLS_HOME/secrets_management/payor_configuration_file_path.yaml"

    # Work on a tmp copy of the payor config yaml so the original on disk
    # is left untouched; point PAYOR_CFG_YAML at the tmp copy for the
    # subsequent secrets-injection step.
    if [[ -f "$PAYOR_CFG_YAML" ]] ; then
        local PAYOR_CFG_YAML_TMP="/tmp/payor_configuration_file_path.yaml"
        cp "$PAYOR_CFG_YAML" "$PAYOR_CFG_YAML_TMP"

        # Refresh payor2+ vm targets in the tmp copy from
        # wl.properties.override before secrets are injected.
        sync_secrets_targets "" "$PAYOR_CFG_YAML_TMP" || echo "WARN: skipping payor2+ target sync (wl.properties.override not found)"

        PAYOR_CFG_YAML="$PAYOR_CFG_YAML_TMP"
    fi

    if [[ -x "$UPDATE_CFG_FILES" && -f "$PAYOR_CFG_YAML" ]] ; then
        echo "Injecting secrets into runtime.properties..."
        "$UPDATE_CFG_FILES" --config "$PAYOR_CFG_YAML" --env "$HOME/.secrets_env"
    fi
    rm -f "$PAYOR_CFG_YAML_TMP"
}
