#!/usr/bin/env bash
#
# moyan-dev.sh — 墨言本地开发一键启停
#
# 用法：
#   ./scripts/moyan-dev.sh start [--ios] [--reinstall]  启动后端/前端/后台；--ios 连带模拟器与 App
#   ./scripts/moyan-dev.sh ios [--reinstall]            只处理模拟器 + App（需要时自动构建安装）
#   ./scripts/moyan-dev.sh stop [--sim]                 停止所有服务；--sim 同时关掉模拟器
#   ./scripts/moyan-dev.sh status                       查看各服务/模拟器状态
#   ./scripts/moyan-dev.sh logs <backend|web|admin|metro|ios>
#
# 环境变量：
#   MOYAN_SIM_NAME  指定模拟器名（默认 iPhone 15 Pro）
#   MOYAN_SIM_UDID  直接指定 UDID（优先级高于 MOYAN_SIM_NAME）
#
# 设计要点（都是踩过坑换来的，改之前先看一眼）：
#   1. 启动顺序：后端 → 前端 → 后台 → Metro → App。App 是 dev-client 构建，
#      Metro 没起来就白屏/报「连不上 development server」，所以 Metro 必须在前。
#   2. 健康检查一律 `curl --noproxy '*'`：本机开着系统代理，代理会把 localhost 目标
#      判成 502，不加这个参数会把「服务正常」误报成启动失败。
#   3. vite dev（5000/5001）只监听 IPv6 回环 [::1]，所以探测要用 localhost，
#      写成 127.0.0.1:5000 会 connection refused。
#   4. `simctl boot` 对已启动设备返回 code=405「Unable to boot device in current state:
#      Booted」——这是幂等提示不是故障，脚本按「已启动」处理，避免误报。
#   5. App 内 API 地址由 dev server 的 host 推导，所以用 localhost 打开 dev-client，
#      App 就会请求 http://localhost:4323，不依赖当前 Wi-Fi 的 LAN IP。
#   6. 后端首跑是 release 构建（lto + codegen-units=1），约 2-3 分钟，超时给到 420s。
#   7. 后台启动一律 `</dev/null`：vite 会读 stdin 做交互快捷键（"press h + enter"），
#      父 shell 的 stdin 是终端时，后台进程一读就被 SIGTTIN 停住（ps 显示 state=T），
#      端口还在 listen 但永不响应 —— 表现为 curl 超时 / HTTP 000 的"假死"。
#   8. 判断输出里有没有某个字符串一律用 `case`/`contains`，不要 `... | grep -q`：
#      grep -q 命中即退出会让上游吃 SIGPIPE，在 `set -o pipefail` 下整条管道被判失败，
#      于是"已安装"被误判成"未安装"（rc=141）。
#   9. 变量引用后紧跟中文/全角字符时必须写 `${var}`：macOS 自带 bash 3.2 会按字节把
#      `$p）` 里的全角括号并进变量名（=> unbound variable: p\xef\xbc\x88）。
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"

APP_BUNDLE_ID="com.anonymous.moyanapp"
APP_PROCESS_NAME="MoYan"
APP_SCHEME="exp+moyan-app"
METRO_PORT=8081
SIM_NAME_DEFAULT="iPhone 15 Pro"

DEV_DIR="$ROOT/.dev"
LOG_DIR="$DEV_DIR/logs"
PID_DIR="$DEV_DIR/pids"
ALL_SERVICES="backend web admin metro"

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  C_RESET=$'\033[0m'; C_BOLD=$'\033[1m'; C_DIM=$'\033[2m'
  C_OK=$'\033[32m'; C_ERR=$'\033[31m'; C_WARN=$'\033[33m'
else
  C_RESET=; C_BOLD=; C_DIM=; C_OK=; C_ERR=; C_WARN=
fi

info() { printf '%s %s\n' "${C_BOLD}▶${C_RESET}" "$*"; }
ok()   { printf '%s %s\n' "${C_OK}✓${C_RESET}" "$*"; }
warn() { printf '%s %s\n' "${C_WARN}!${C_RESET}" "$*"; }
err()  { printf '%s %s\n' "${C_ERR}✗${C_RESET}" "$*" >&2; }
dim()  { printf '%s\n' "${C_DIM}$*${C_RESET}"; }
die()  { err "$*"; exit 1; }

FAILED=""
mark_fail() { FAILED="$FAILED $1"; }

# ── 服务元数据 ────────────────────────────────────────────────────────────────
svc_port() {
  case "$1" in
    backend) echo 4323 ;;
    web)     echo 5000 ;;
    admin)   echo 5001 ;;
    metro)   echo "$METRO_PORT" ;;
  esac
}
svc_dir() {
  case "$1" in
    backend) echo "$ROOT/moyan-backend" ;;
    web)     echo "$ROOT/moyan-web" ;;
    admin)   echo "$ROOT/moyan-admin" ;;
    metro)   echo "$ROOT/moyan-app" ;;
  esac
}
svc_cmd() {
  case "$1" in
    backend) echo "./dev-run.sh" ;;
    web|admin) echo "npm run dev" ;;
    metro)   echo "npx expo start --port $METRO_PORT" ;;
  esac
}
svc_path() {
  case "$1" in
    backend) echo "/api/health" ;;
    metro)   echo "/status" ;;
    *)       echo "/" ;;
  esac
}
svc_desc() {
  case "$1" in
    backend) echo "moyan-backend  :4323" ;;
    web)     echo "moyan-web      :5000" ;;
    admin)   echo "moyan-admin    :5001" ;;
    metro)   echo "metro (expo)   :$METRO_PORT" ;;
  esac
}
svc_timeout() {
  case "$1" in
    backend) echo 420 ;;  # release 构建，首跑 2-3 分钟
    metro)   echo 180 ;;
    *)       echo 120 ;;
  esac
}

# ── 基础工具 ──────────────────────────────────────────────────────────────────
port_pid()       { lsof -nP -iTCP:"$1" -sTCP:LISTEN -t 2>/dev/null | head -1; }
port_listening() { [ -n "$(port_pid "$1")" ]; }
pid_alive()      { [ -n "${1:-}" ] && kill -0 "$1" 2>/dev/null; }

proc_name() {
  [ -n "${1:-}" ] && ps -o comm= -p "$1" 2>/dev/null | sed 's|.*/||' || echo "?"
}

# 进程状态。T = stopped：后台启动的 vite 会去读 stdin（交互快捷键），
# 父 shell 的 stdin 是终端时会被 SIGTTIN 停住 —— 端口还在 listen 但永不响应。
pid_state() {
  [ -n "${1:-}" ] && ps -o stat= -p "$1" 2>/dev/null | tr -d ' \n' || echo ""
}

is_stopped() {
  case "$(pid_state "$1")" in *T*) return 0 ;; *) return 1 ;; esac
}

contains() { case "$1" in *"$2"*) return 0 ;; *) return 1 ;; esac; }

# 依次尝试 localhost / 127.0.0.1，返回 HTTP 状态码（000 = 连不上）
# --noproxy 必须有：本机系统代理会把 localhost 目标判成 502（见文件头第 2 条）
http_code() {
  path="$1"; port="$2"; host=""; code=""
  for host in localhost 127.0.0.1; do
    code="$(curl --noproxy '*' -s -o /dev/null -m 3 -w '%{http_code}' "http://$host:$port$path" 2>/dev/null)"
    if [ -n "$code" ] && [ "$code" != "000" ]; then
      printf '%s' "$code"; return 0
    fi
  done
  printf '000'
}

tail_n() {
  if [ -f "$1" ]; then
    dim "  ── $1 最后 ${2} 行 ──"
    tail -n "$2" "$1" | sed 's/^/  /'
  fi
}

kill_tree() {
  p="$1"
  for c in $(pgrep -P "$p" 2>/dev/null); do kill_tree "$c"; done
  kill "$p" 2>/dev/null
}

# ── 服务启动 / 等待就绪 ───────────────────────────────────────────────────────
wait_ready() {
  name="$1"; limit="$(svc_timeout "$name")"; port="$(svc_port "$name")"; path="$(svc_path "$name")"
  i=0
  while [ "$i" -lt "$limit" ]; do
    code="$(http_code "$path" "$port")"
    if [ "$code" = "200" ]; then
      ok "$(svc_desc "$name") 就绪（$path → HTTP 200）"
      return 0
    fi

    # 进程已死或被挂起就别干等了，直接把日志尾巴打出来
    pidfile="$PID_DIR/$name.pid"
    if [ -f "$pidfile" ]; then
      p="$(cat "$pidfile")"
      if ! pid_alive "$p" && ! port_listening "$port"; then
        err "$(svc_desc "$name") 启动失败：进程已退出"
        tail_n "$LOG_DIR/$name.log" 30
        return 1
      fi
      # 端口 listen 但 HTTP 不通 + 进程 state=T → SIGTTIN 挂起（见文件头第 7 条）
      if [ "$i" -ge 3 ] && pid_alive "$p" && is_stopped "$p"; then
        err "$(svc_desc "$name") 进程被挂起（state=$(pid_state "$p")）：后台进程读了终端 stdin"
        dim "  典型原因是启动时没有把 stdin 接到 /dev/null；前台手动跑一次可恢复（fg）。"
        tail_n "$LOG_DIR/$name.log" 20
        return 1
      fi
    fi

    if [ "$name" = "backend" ] && [ $((i % 30)) -eq 0 ] && [ "$i" -gt 0 ]; then
      dim "  … 后端 release 构建通常 2-3 分钟，已等 ${i}s"
    fi
    i=$((i + 1))
    sleep 1
  done
  err "$(svc_desc "$name") 启动超时（${limit}s，最后 HTTP ${code}）"
  tail_n "$LOG_DIR/$name.log" 30
  return 1
}

start_service() {
  name="$1"; port="$(svc_port "$name")"
  mkdir -p "$PID_DIR" "$LOG_DIR"

  # metro 归 launchd 管，不在这里起（起了也会被守护进程再拉一份，端口打架）
  if [ "$name" = "metro" ] && metro_launchd_managed; then
    ok "metro 由 launchd 托管（${METRO_LAUNCHD_LABEL}）；日志 ${METRO_LAUNCHD_LOG}"
    wait_ready metro && return 0
    return 1
  fi

  if port_listening "$port"; then
    p="$(port_pid "$port")"
    ok "$(svc_desc "$name") 已在运行（pid $p = $(proc_name "$p")）"
    return 0
  fi

  dir="$(svc_dir "$name")"; cmd="$(svc_cmd "$name")"
  [ -d "$dir" ] || { err "目录不存在：$dir"; return 1; }

  log="$LOG_DIR/$name.log"
  : > "$log"
  # 说明：
  #   </dev/null  防止 vite 读终端 stdin 被 SIGTTIN 停住（文件头第 7 条）
  #   nohup       让服务扛住启动它的终端/shell 退出（SIGHUP），不然关掉终端就一起死
  (
    cd "$dir" || exit 1
    nohup sh -c "exec $cmd" >>"$log" 2>&1 </dev/null &
    echo $! > "$PID_DIR/$name.pid"
  )
  p="$(cat "$PID_DIR/$name.pid")"
  info "$(svc_desc "$name") 启动中（pid ${p}）→ $log"
  wait_ready "$name"
}

# ── 模拟器 + App ──────────────────────────────────────────────────────────────

# metro 在这台机器上由 launchd agent `com.moyan.expo` 托管（KeepAlive=1，
# RunAtLoad=1）：kill 掉会被立刻拉起来。所以脚本**不**去启停 metro —— 只校验状态，
# 需要重启时用 launchctl kickstart。它的日志在 plist 的 StandardOutPath 里。
METRO_LAUNCHD_LABEL="com.moyan.expo"
METRO_LAUNCHD_LOG="/tmp/moyan-logs/expo-launchagent.log"

metro_launchd_managed() {
  [ -f "$HOME/Library/LaunchAgents/$METRO_LAUNCHD_LABEL.plist" ] \
    && contains "$(launchctl list 2>/dev/null)" "$METRO_LAUNCHD_LABEL"
}

metro_launchd_restart() {
  launchctl kickstart -k "gui/$(id -u)/$METRO_LAUNCHD_LABEL" >/dev/null 2>&1 \
    || launchctl stop "$METRO_LAUNCHD_LABEL" >/dev/null 2>&1
}

sim_udid() {
  if [ -n "${MOYAN_SIM_UDID:-}" ]; then printf '%s' "$MOYAN_SIM_UDID"; return 0; fi
  u="$(xcrun simctl list devices available -j 2>/dev/null \
        | jq -r --arg n "${MOYAN_SIM_NAME:-$SIM_NAME_DEFAULT}" \
          '.devices[][] | select(.isAvailable and .name == $n) | .udid' | head -1)"
  if [ -z "$u" ] || [ "$u" = "null" ]; then
    u="$(xcrun simctl list devices available -j 2>/dev/null \
          | jq -r '[.devices[][] | select(.isAvailable and (.name | test("^iPhone")))][0].udid')"
  fi
  [ "$u" = "null" ] && u=""
  printf '%s' "$u"
}

sim_running() { contains "$(xcrun simctl list devices booted 2>/dev/null)" "$1"; }

sim_start() {
  udid="$(sim_udid)"
  [ -n "$udid" ] || { err "找不到可用模拟器（可用 MOYAN_SIM_NAME / MOYAN_SIM_UDID 指定）"; return 1; }

  if sim_running "$udid"; then
    ok "模拟器已在运行（${udid}）"
  else
    info "启动模拟器 $udid …"
    out="$(xcrun simctl boot "$udid" 2>&1)"
    if [ $? -ne 0 ]; then
      case "$out" in
        *"current state: Booted"*) ok "模拟器已处于 Booted（simctl 幂等提示，非故障）" ;;
        *) err "模拟器启动失败：$out"; return 1 ;;
      esac
    else
      ok "模拟器已启动"
    fi
  fi

  open -a Simulator >/dev/null 2>&1 || warn "open -a Simulator 失败（窗口没弹出来，但设备已 booted）"
  xcrun simctl bootstatus "$udid" -b >/dev/null 2>&1 || warn "bootstatus 未通过，设备可能仍在启动中"
  SIM_UDID="$udid"
}

app_installed() { contains "$(xcrun simctl listapps "$1" 2>/dev/null)" "$APP_BUNDLE_ID"; }
app_running()   { contains "$(xcrun simctl spawn "$1" launchctl list 2>/dev/null)" "$APP_BUNDLE_ID"; }

launch_app() {
  udid="$1"
  xcrun simctl terminate "$udid" "$APP_BUNDLE_ID" >/dev/null 2>&1
  sleep 1

  url="$APP_SCHEME://expo-development-client/?url=http%3A%2F%2Flocalhost%3A$METRO_PORT"
  info "打开 dev-client 指向 Metro（localhost:${METRO_PORT}）…"
  if ! xcrun simctl openurl "$udid" "$url" >/dev/null 2>&1; then
    warn "deep link 打开失败，退回 simctl launch"
    xcrun simctl launch "$udid" "$APP_BUNDLE_ID" >/dev/null 2>&1 \
      || { err "App 启动失败"; return 1; }
  fi

  sleep 10
  if app_running "$udid"; then
    ok "App 已运行"
  else
    err "App 进程没起来（先确认 Metro 是否在 :$METRO_PORT 上）"
    return 1
  fi

  # 自检：App 有没有连不上后端（只统计 :4323，RN DevTools 的 :8097 噪音要排除）
  n="$(xcrun simctl spawn "$udid" log show --last 90s \
        --predicate "process == \"$APP_PROCESS_NAME\"" --style compact 2>/dev/null \
        | grep -E 'Could not connect|Connection refused' | grep -c ':4323' || true)"
  if [ "${n:-0}" -gt 0 ]; then
    warn "App 日志里有 $n 条连不上后端(:4323)的记录 —— 检查后端是否在跑"
  fi
}

cmd_ios() {
  reinstall="$1"
  sim_start || return 1
  udid="$SIM_UDID"

  # dev-client 必须先有 Metro（文件头第 1 条）
  start_service metro || { mark_fail metro; return 1; }

  mkdir -p "$LOG_DIR"
  if [ "$reinstall" = "1" ] || ! app_installed "$udid"; then
    info "构建并安装 App（expo run:ios --no-bundler）…首跑 1-3 分钟"
    if ! ( cd "$ROOT/moyan-app" && npx expo run:ios --no-bundler --device "$udid" ) >>"$LOG_DIR/ios.log" 2>&1; then
      err "App 构建/安装失败"
      tail_n "$LOG_DIR/ios.log" 40
      return 1
    fi
    grep -E "Build Succeeded|error:|Build failed" "$LOG_DIR/ios.log" | tail -3 | sed 's/^/  /'
    ok "App 已安装（${APP_BUNDLE_ID}）"
  else
    dim "App 已安装，跳过构建（要强制重装用 --reinstall）"
  fi

  launch_app "$udid" || return 1
}

sim_stop() {
  udid="$(sim_udid)"
  [ -n "$udid" ] || return 0
  if sim_running "$udid"; then
    xcrun simctl shutdown "$udid" >/dev/null 2>&1 && ok "模拟器已关闭" || warn "模拟器关闭失败"
  else
    dim "模拟器本来就未运行"
  fi
}

# ── 命令 ──────────────────────────────────────────────────────────────────────
summary() {
  printf '\n%s\n' "${C_BOLD}── 汇总 ──────────────────────────────${C_RESET}"
  for s in $ALL_SERVICES; do
    port="$(svc_port "$s")"; code="$(http_code "$(svc_path "$s")" "$port")"
    if [ "$code" = "200" ]; then
      printf '  %s %-24s %s\n' "${C_OK}✓${C_RESET}" "$(svc_desc "$s")" "HTTP 200  http://localhost:$port"
    elif port_listening "$port"; then
      printf '  %s %-24s %s\n' "${C_WARN}~${C_RESET}" "$(svc_desc "$s")" "端口占用但 HTTP $code"
    else
      printf '  %s %-24s %s\n' "${C_ERR}✗${C_RESET}" "$(svc_desc "$s")" "未运行"
    fi
  done
  udid="$(sim_udid)"
  if [ -n "$udid" ] && sim_running "$udid"; then
    if app_running "$udid"; then
      printf '  %s %-24s %s\n' "${C_OK}✓${C_RESET}" "iOS 模拟器" "运行中，App 已启动（${udid}）"
    else
      printf '  %s %-24s %s\n' "${C_WARN}~${C_RESET}" "iOS 模拟器" "运行中，App 未启动（${udid}）"
    fi
  else
    printf '  %s %-24s %s\n' "${C_DIM}·${C_RESET}" "iOS 模拟器" "未运行"
  fi

  if [ -n "${FAILED// /}" ]; then
    printf '\n'
    err "以下步骤失败：$FAILED"
    return 1
  fi
  printf '\n'
  ok "全部就绪"
  dim "  前端 http://localhost:5000 · 管理后台 http://localhost:5001 · API http://localhost:4323"
  dim "  注意：5000/5001 只监听 IPv6 回环，请用 localhost 而非 127.0.0.1 访问"
  return 0
}

cmd_start() {
  with_ios=0; reinstall=0
  while [ $# -gt 0 ]; do
    case "$1" in
      --ios) with_ios=1 ;;
      --reinstall) reinstall=1 ;;
      *) die "未知参数：$1" ;;
    esac
    shift
  done

  for s in backend web admin; do
    start_service "$s" || mark_fail "$s"
  done
  if [ "$with_ios" = "1" ]; then
    cmd_ios "$reinstall" || mark_fail ios
  fi
  summary
}

cmd_status() {
  printf '%-28s %-6s %-8s %-8s %s\n' "SERVICE" "PORT" "PID" "HTTP" "PROC"
  for s in $ALL_SERVICES; do
    port="$(svc_port "$s")"; p="$(port_pid "$port")"
    if [ -n "$p" ]; then
      printf '%-28s %-6s %-8s %-8s %s\n' "$(svc_desc "$s")" "$port" "$p" "$(http_code "$(svc_path "$s")" "$port")" "$(proc_name "$p")"
    else
      printf '%-28s %-6s %-8s %-8s %s\n' "$(svc_desc "$s")" "$port" "-" "000" "-"
    fi
  done
  udid="$(sim_udid)"
  if [ -n "$udid" ] && sim_running "$udid"; then
    printf '\n模拟器：运行中 %s\n' "$udid"
    if app_installed "$udid"; then printf 'App    ：已安装\n'; else printf 'App    ：未安装\n'; fi
  else
    printf '\n模拟器：未运行\n'
  fi
  return 0
}

cmd_stop() {
  with_sim=0
  while [ $# -gt 0 ]; do
    case "$1" in
      --sim) with_sim=1 ;;
      *) die "未知参数：$1" ;;
    esac
    shift
  done

  for s in $ALL_SERVICES; do
    # metro 由 launchd 托管：kill 了也会被 KeepAlive 立刻拉起来，跳过并说明
    if [ "$s" = "metro" ] && metro_launchd_managed; then
      dim "metro 由 launchd 托管（KeepAlive），已跳过；要停：launchctl bootout gui/$(id -u)/$METRO_LAUNCHD_LABEL"
      continue
    fi
    port="$(svc_port "$s")"; pidfile="$PID_DIR/$s.pid"; p=""
    [ -f "$pidfile" ] && p="$(cat "$pidfile")"
    [ -z "$p" ] && p="$(port_pid "$port")"
    if [ -n "$p" ] && pid_alive "$p"; then
      kill_tree "$p"
      sleep 1
      pid_alive "$p" && kill -9 "$p" 2>/dev/null
    fi
    if port_listening "$port"; then
      hp="$(port_pid "$port")"
      kill -9 "$hp" 2>/dev/null
      warn "$s 有残留监听进程，已强杀（pid ${hp}）"
    fi
    rm -f "$pidfile"
    ok "$s 已停止"
  done

  [ "$with_sim" = "1" ] && sim_stop
  return 0
}

cmd_logs() {
  s="${1:-}"
  [ -n "$s" ] || die "用法：$0 logs <backend|web|admin|metro|ios>"
  if [ "$s" = "metro" ] && metro_launchd_managed; then
    # metro 的 stdout 由 plist 指定，脚本自己那份日志是空的
    [ -f "$METRO_LAUNCHD_LOG" ] || die "没有日志：$METRO_LAUNCHD_LOG"
    tail -f "$METRO_LAUNCHD_LOG"
  fi
  f="$LOG_DIR/$s.log"
  [ -f "$f" ] || die "没有日志：$f"
  tail -f "$f"
}

usage() {
  sed -n '3,17p' "$0" | sed 's/^# \{0,1\}//'
}

mkdir -p "$PID_DIR" "$LOG_DIR"

cmd="${1:-}"; shift 2>/dev/null || true
case "$cmd" in
  start)  cmd_start "$@" ;;
  ios)
    reinstall=0
    while [ $# -gt 0 ]; do
      case "$1" in
        --reinstall) reinstall=1 ;;
        *) die "未知参数：$1" ;;
      esac
      shift
    done
    cmd_ios "$reinstall" || mark_fail ios
    summary
    ;;
  stop)   cmd_stop "$@" ;;
  status) cmd_status "$@" ;;
  logs)   cmd_logs "$@" ;;
  ""|-h|--help|help) usage ;;
  *) die "未知命令：${cmd}（用 --help 看用法）" ;;
esac
