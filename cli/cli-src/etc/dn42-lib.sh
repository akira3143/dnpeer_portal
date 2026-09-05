#!/bin/busybox sh
# dn42-lib.sh —— CLI Public Helper Library
# Thin HTTP/JSON layer with zero business drift.

API_BASE="${API_BASE:-http://10.0.2.2:4242}"

# Source single-source rules if available
if [ -f /lib/rules.sh ]; then
  . /lib/rules.sh
elif [ -f "${0%/*}/../lib/rules.sh" ]; then
  . "${0%/*}/../lib/rules.sh"
elif [ -f "cli-src/lib/rules.sh" ]; then
  . "cli-src/lib/rules.sh"
fi

dn42_token() {
  if [ -f /mnt/persist/.dn42/token ]; then
    cat /mnt/persist/.dn42/token 2>/dev/null
  else
    cat /tmp/dn42_token 2>/dev/null
  fi
}

dn42_asn() {
  if [ -f /mnt/persist/.dn42/asn ]; then
    cat /mnt/persist/.dn42/asn 2>/dev/null
  else
    cat /tmp/dn42_asn 2>/dev/null
  fi
}

check_auth_response() {
  _resp="$1"
  if echo "$_resp" | grep -q '"code":401\|"Unauthorized"'; then
    echo -e "\033[31merror: Session expired, please login again.\033[0m" >&2
  fi
}

# api_get <path>  → stdout response body
api_get() {
  local token resp
  token=$(dn42_token)
  if [ -n "$token" ]; then
    resp=$(wget -q -T 15 -O - --header="Authorization: Bearer $token" "$API_BASE$1" 2>/dev/null || curl -s -m 15 -H "Authorization: Bearer $token" "$API_BASE$1" 2>/dev/null)
  else
    resp=$(wget -q -T 15 -O - "$API_BASE$1" 2>/dev/null || curl -s -m 15 "$API_BASE$1" 2>/dev/null)
  fi
  check_auth_response "$resp"
  printf '%s' "$resp"
}

# api_post <path> <json-payload>  → stdout response body
api_post() {
  local token resp attempt
  token=$(dn42_token)
  resp=""
  for attempt in 1 2; do
    if [ -n "$token" ]; then
      resp=$(wget -q -T 15 -O - --post-data="$2" --header="Content-Type: application/json" --header="Authorization: Bearer $token" "$API_BASE$1" 2>/dev/null || curl -s -m 15 -X POST -H "Content-Type: application/json" -H "Authorization: Bearer $token" -d "$2" "$API_BASE$1" 2>/dev/null)
    else
      resp=$(wget -q -T 15 -O - --post-data="$2" --header="Content-Type: application/json" "$API_BASE$1" 2>/dev/null || curl -s -m 15 -X POST -H "Content-Type: application/json" -d "$2" "$API_BASE$1" 2>/dev/null)
    fi
    if [ -n "$resp" ]; then
      case "$resp" in *'}'*) break ;; esac
    fi
    [ "$attempt" = "1" ] && sleep 1
  done
  check_auth_response "$resp"
  printf '%s' "$resp"
}

# api_delete <path> [optional_id] → stdout response body
api_delete() {
  local target_id="$2"
  if [ -z "$target_id" ]; then
    target_id="${1##*/}"
  fi
  api_post "/api/sessions/remove" "{\"sessionId\":\"$target_id\"}"
}

json_field() {
  echo "$1" | awk -v field="$2" '
  {
    target = "\"" field "\":\""
    idx = index($0, target)
    if (idx > 0) {
      rest = substr($0, idx + length(target))
      out = ""
      for (i = 1; i <= length(rest); i++) {
        c = substr(rest, i, 1)
        if (c == "\\") {
          n = substr(rest, i+1, 1)
          if (n == "\"" || n == "\\") { out = out n; i++; continue }
          out = out c
          continue
        }
        if (c == "\"") break
        out = out c
      }
      print out
    } else {
      # numeric value fallback: "field":123 or "field": 123
      target = "\"" field "\":"
      idx = index($0, target)
      if (idx > 0) {
        rest = substr($0, idx + length(target))
        sub(/^[ \t]+/, "", rest)
        out = ""
        for (i = 1; i <= length(rest); i++) {
          c = substr(rest, i, 1)
          if (c ~ /[0-9]/) out = out c; else break
        }
        print out
      }
    }
  }'
}

json_num() {
  echo "$1" | sed -n "s/.*\"$2\":\([0-9][0-9]*\).*/\1/p"
}

json_bool() {
  echo "$1" | sed -n "s/.*\"$2\":\(true\|false\).*/\1/p"
}

require_login() {
  if [ ! -s /tmp/dn42_token ]; then
    echo -e "\033[31merror: Not signed in. Authenticate with your ASN first.\033[0m"
    return 1
  fi
  return 0
}

flush_after_input() {
  while read -r -t 0.05 _dn42_flush 2>/dev/null; do
    :
  done
}

# read_line_edit <var_name> [-s/--secret]
# Minimal line editor supporting Left/Right/Home/End/Backspace/Delete with 0-fork built-in read (U16)
read_line_edit() {
  local _target_var="$1"
  local _is_secret="$2"
  local _buf=""
  local _pos=0
  local _c _c2 _c3 _c4 _old_stty _i _left _right _remaining _char _diff _rem_len

  # Fallback for non-interactive / piped environments
  if [ ! -t 0 ]; then
    if [ "$_is_secret" = "-s" ] || [ "$_is_secret" = "--secret" ]; then
      stty -echo 2>/dev/null
      read -r _buf
      stty echo 2>/dev/null
    else
      read -r _buf
    fi
    if [ -n "$_target_var" ]; then
      export "$_target_var=$_buf"
    fi
    REPLY="$_buf"
    return 0
  fi

  _old_stty=$(stty -g 2>/dev/null)
  stty -icanon -echo -isig min 1 time 0 2>/dev/null || stty raw -echo 2>/dev/null

  while true; do
    _c=""
    if ! IFS= read -r -n 1 _c; then
      printf "\r\n"
      break
    fi

    # Enter (\r or \n or empty when Enter key pressed)
    if [ "$_c" = "$(printf '\r')" ] || [ "$_c" = "$(printf '\n')" ] || [ -z "$_c" ]; then
      printf "\r\n"
      break
    fi

    # Ctrl+C (Interrupt \003)
    if [ "$_c" = "$(printf '\003')" ]; then
      _buf="q"
      printf "\r\n"
      break
    fi

    # Backspace (ASCII 8 \b or 127 \177)
    if [ "$_c" = "$(printf '\b')" ] || [ "$_c" = "$(printf '\177')" ]; then
      if [ $_pos -gt 0 ]; then
        if [ "$_is_secret" = "-s" ] || [ "$_is_secret" = "--secret" ]; then
          _buf="${_buf%?}"
          _pos=$((_pos - 1))
          printf "\b \b"
        else
          _i=0; _left=""; _right=""; _remaining="$_buf"
          while [ -n "$_remaining" ]; do
            if [ $_i -eq $_pos ]; then _right="$_remaining"; break; fi
            _char="${_remaining%${_remaining#?}}"
            _left="${_left}${_char}"
            _remaining="${_remaining#?}"
            _i=$((_i + 1))
          done
          _left="${_left%?}"
          _buf="${_left}${_right}"
          _pos=$((_pos - 1))
          _rem_len=$((${#_right} + 1))
          printf "\b%s \033[%dD" "$_right" "$_rem_len"
        fi
      fi
      continue
    fi

    # Escape Sequences (\033) - V3: 0.05s timeout to prevent standalone ESC lag
    if [ "$_c" = "$(printf '\033')" ]; then
      _c2=""
      IFS= read -r -n 1 -t 0.05 _c2 2>/dev/null
      if [ "$_c2" = "[" ] || [ "$_c2" = "O" ]; then
        _c3=""
        IFS= read -r -n 1 -t 0.05 _c3 2>/dev/null
        case "$_c3" in
          "D") # Left Arrow
            if [ $_pos -gt 0 ]; then
              _pos=$((_pos - 1))
              printf "\033[D"
            fi
            ;;
          "C") # Right Arrow
            if [ $_pos -lt ${#_buf} ]; then
              _pos=$((_pos + 1))
              printf "\033[C"
            fi
            ;;
          "H") # Home
            if [ $_pos -gt 0 ]; then
              printf "\033[%dD" "$_pos"
              _pos=0
            fi
            ;;
          "F") # End
            if [ $_pos -lt ${#_buf} ]; then
              _diff=$(( ${#_buf} - _pos ))
              printf "\033[%dC" "$_diff"
              _pos=${#_buf}
            fi
            ;;
          "1"|"7") # Extended Home (1~ or 7~)
            IFS= read -r -n 1 -t 0.05 _c4 2>/dev/null
            if [ $_pos -gt 0 ]; then
              printf "\033[%dD" "$_pos"
              _pos=0
            fi
            ;;
          "4"|"8") # Extended End (4~ or 8~)
            IFS= read -r -n 1 -t 0.05 _c4 2>/dev/null
            if [ $_pos -lt ${#_buf} ]; then
              _diff=$(( ${#_buf} - _pos ))
              printf "\033[%dC" "$_diff"
              _pos=${#_buf}
            fi
            ;;
          "3") # Delete (3~)
            IFS= read -r -n 1 -t 0.05 _c4 2>/dev/null
            if [ $_pos -lt ${#_buf} ]; then
              _i=0; _left=""; _right=""; _remaining="$_buf"
              while [ -n "$_remaining" ]; do
                if [ $_i -eq $_pos ]; then _right="$_remaining"; break; fi
                _char="${_remaining%${_remaining#?}}"
                _left="${_left}${_char}"
                _remaining="${_remaining#?}"
                _i=$((_i + 1))
              done
              _right="${_right#?}"
              _buf="${_left}${_right}"
              _rem_len=$((${#_right} + 1))
              printf "%s \033[%dD" "$_right" "$_rem_len"
            fi
            ;;
          *)
            ;;
        esac
      fi
      continue
    fi

    # Normal Printable Characters
    if [ "$_is_secret" = "-s" ] || [ "$_is_secret" = "--secret" ]; then
      _buf="${_buf}${_c}"
      _pos=$((_pos + 1))
      printf "*"
    else
      if [ $_pos -eq ${#_buf} ]; then
        _buf="${_buf}${_c}"
        _pos=$((_pos + 1))
        printf "%s" "$_c"
      else
        _i=0; _left=""; _right=""; _remaining="$_buf"
        while [ -n "$_remaining" ]; do
          if [ $_i -eq $_pos ]; then _right="$_remaining"; break; fi
          _char="${_remaining%${_remaining#?}}"
          _left="${_left}${_char}"
          _remaining="${_remaining#?}"
          _i=$((_i + 1))
        done
        _buf="${_left}${_c}${_right}"
        _pos=$((_pos + 1))
        _rem_len=${#_right}
        if [ $_rem_len -gt 0 ]; then
          printf "%s%s\033[%dD" "$_c" "$_right" "$_rem_len"
        else
          printf "%s" "$_c"
        fi
      fi
    fi
  done

  if [ -n "$_old_stty" ]; then
    stty "$_old_stty" 2>/dev/null
  else
    stty icanon echo 2>/dev/null
  fi

  if [ -n "$_target_var" ]; then
    export "$_target_var=$_buf"
  fi
  REPLY="$_buf"
}

# colorize_bird_output —— High-fidelity BIRD 2.x protocol/status syntax highlighter
colorize_bird_output() {
  awk '
  BEGIN {
    c_reset = "\033[0m"
    c_dim = "\033[90m"
    c_header = "\033[1;37m"
    c_name = "\033[38;5;111m"
    c_proto = "\033[38;5;147m"
    c_table = "\033[90m"
    c_white = "\033[37m"
    c_yellow = "\033[33m"
    c_orange = "\033[38;5;208m"
    c_cyan = "\033[36m"
    c_est = "\033[38;5;153m"
    c_conn = "\033[38;5;222m"
    c_act = "\033[38;5;215m"
    c_idle = "\033[38;5;246m"
    c_err = "\033[1;31mError\033[0m"
  }
  {
    line = $0
    sub(/\r$/, "", line)
    if (line ~ /^[[:space:]]*$/) next

    # Ready banner line or numeric reply codes
    if (line ~ /^(0001\s+)?BIRD\s+/i) {
      sub(/^[0-9]{4}[- ]/, "", line)
      printf "%s%s%s\n", c_dim, line, c_reset
      next
    }
    if (line ~ /^[0-9]{4}[[:space:]]*$/) next

    # Header line
    if (line ~ /^[0-9]{4}-?[[:space:]]*[Nn]ame[[:space:]]+[Pp]roto/ || line ~ /^[[:space:]]*[Nn]ame[[:space:]]+[Pp]roto/) {
      sub(/^[0-9]{4}[- ]/, "", line)
      printf "%s%-16s %-10s %-10s %-6s %-14s %s%s\n", c_header, "Name", "Proto", "Table", "State", "Since", "Info", c_reset
      next
    }

    # Protocol entry row
    sub(/^[0-9]{4}[- ]/, "", line)
    n = split(line, f, /[ \t]+/)
    if (n >= 4 && (f[2] ~ /^(BGP|BFD|Device|Direct|Static|OSPF|Kernel|Pipe|ROA|BABEL|RIP)$/i)) {
      p_name = sprintf("%s%-16s%s", c_name, f[1], c_reset)
      p_proto = sprintf("%s%-10s%s", c_proto, f[2], c_reset)
      p_table = sprintf("%s%-10s%s", c_table, f[3], c_reset)

      st = tolower(f[4])
      if (st == "up") p_state = sprintf("%s%-6s%s", c_white, f[4], c_reset)
      else if (st == "start") p_state = sprintf("%s%-6s%s", c_yellow, f[4], c_reset)
      else p_state = sprintf("%s%-6s%s", c_dim, f[4], c_reset)

      since_val = (n >= 5) ? f[5] : ""
      if (since_val ~ /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/) {
        p_since = sprintf("%s%-14s%s", c_orange, since_val, c_reset)
      } else if (since_val ~ /^[0-9]{2}:[0-9]{2}:[0-9]{2}/) {
        p_since = sprintf("%s%-14s%s", c_cyan, since_val, c_reset)
      } else {
        p_since = sprintf("%s%-14s%s", c_white, since_val, c_reset)
      }

      info_val = ""
      if (n >= 6) {
        for (i = 6; i <= n; i++) {
          info_val = (i == 6) ? f[i] : (info_val " " f[i])
        }
      }

      p_info = info_val
      if (info_val != "") {
        gsub(/Error/, c_err, info_val)
        if (f[6] == "Established") {
          p_info = sprintf("%sEstablished%s %s", c_est, c_reset, substr(info_val, 13))
        } else if (f[6] == "Connect") {
          p_info = sprintf("%sConnect%s %s", c_conn, c_reset, substr(info_val, 9))
        } else if (f[6] == "Active") {
          p_info = sprintf("%sActive%s %s", c_act, c_reset, substr(info_val, 8))
        } else if (f[6] == "Idle") {
          p_info = sprintf("%sIdle%s %s", c_idle, c_reset, substr(info_val, 6))
        } else {
          p_info = sprintf("%s%s%s", c_white, info_val, c_reset)
        }
      }

      printf "%s %s %s %s %s %s\n", p_name, p_proto, p_table, p_state, p_since, p_info
    } else {
      # Other details lines (e.g. show protocols all or show route)
      gsub(/Error/, c_err, line)
      print line
    }
  }
  '
}

