#!/bin/busybox sh
# dn42-lib.sh —— CLI Public Helper Library
# Thin HTTP/JSON layer with zero business drift.

API_BASE="http://10.0.2.2:4242"

# Source single-source rules if available
[ -f /lib/rules.sh ] && . /lib/rules.sh

dn42_token() {
  cat /tmp/dn42_token 2>/dev/null
}

dn42_asn() {
  cat /tmp/dn42_asn 2>/dev/null
}

# api_get <path>  → stdout response body
api_get() {
  local token
  token=$(dn42_token)
  if [ -n "$token" ]; then
    wget -q -T 15 -O - --header="Authorization: Bearer $token" "$API_BASE$1" 2>/dev/null
  else
    wget -q -T 15 -O - "$API_BASE$1" 2>/dev/null
  fi
}

# api_post <path> <json-payload>  → stdout response body
api_post() {
  local token resp attempt
  token=$(dn42_token)
  resp=""
  for attempt in 1 2; do
    if [ -n "$token" ]; then
      resp=$(wget -q -T 15 -O - --post-data="$2" --header="Content-Type: application/json" --header="Authorization: Bearer $token" "$API_BASE$1" 2>/dev/null)
    else
      resp=$(wget -q -T 15 -O - --post-data="$2" --header="Content-Type: application/json" "$API_BASE$1" 2>/dev/null)
    fi
    if [ -n "$resp" ]; then
      case "$resp" in *'}'*) break ;; esac
    fi
    [ "$attempt" = "1" ] && sleep 1
  done
  printf '%s' "$resp"
}

# api_delete <path>  → stdout response body
api_delete() {
  local token
  token=$(dn42_token)
  if [ -n "$token" ]; then
    wget -q -T 15 -O - --method=DELETE --header="Authorization: Bearer $token" "$API_BASE$1" 2>/dev/null
  else
    wget -q -T 15 -O - --method=DELETE "$API_BASE$1" 2>/dev/null
  fi
}

json_field() {
  echo "$1" | sed -n "s/.*\"$2\":\"\([^\"]*\)\".*/\1/p"
}

json_num() {
  echo "$1" | sed -n "s/.*\"$2\":\([0-9][0-9]*\).*/\1/p"
}

json_bool() {
  echo "$1" | sed -n "s/.*\"$2\":\(true\|false\).*/\1/p"
}

require_login() {
  if [ ! -s /tmp/dn42_token ]; then
    echo -e "\033[31merror: Not signed in. Please run 'login' first.\033[0m"
    return 1
  fi
  return 0
}

flush_after_input() {
  read -r -t 0.2 _dn42_flush 2>/dev/null
}
