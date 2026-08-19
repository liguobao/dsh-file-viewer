#!/usr/bin/env bash
# Restart the dsh web service (port 43123) after installing/updating plugins.
# Safe by design: pre-flights the new tree on port 43124 first; on any
# preflight failure it aborts and leaves the live service untouched.
set -u

export HOME=/home/liguobao
export DSH_HOME=/home/liguobao/.dsh
export PATH=/home/liguobao/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
NODE=/home/liguobao/.nvm/versions/node/v22.23.0/bin/node
DSH_BIN=/home/liguobao/.nvm/versions/node/v22.23.0/lib/node_modules/@deepseek-ai/dsh/lib/bin.js
REPO=/home/liguobao/workspace/liguobao/dph-plugin/dsh-file-viewer
RESTART_LOG=/home/liguobao/.dsh/dsh-web-restart.log
MAIN_LOG=/home/liguobao/.dsh/dsh-web.log
PRE_LOG=/home/liguobao/.dsh/dsh-web-preflight.log

exec >>"$RESTART_LOG" 2>&1
echo "==== $(date '+%F %T') dsh web restart ===="
echo "plugin version: $("$NODE" -e "console.log(require('$REPO/package.json').version)")"
echo "git head: $(git -C "$REPO" log --oneline -1 2>/dev/null)"

# ---------- preflight: boot dsh web on 43124 ----------
echo "--- preflight: boot dsh web on 43124 ---"
"$NODE" "$DSH_BIN" web --host 127.0.0.1 --port 43124 >"$PRE_LOG" 2>&1 &
PRE_PID=$!
PRE_OK=0
for i in $(seq 1 25); do
  CODE=$(curl -sS -o /dev/null -w "%{http_code}" --max-time 2 http://127.0.0.1:43124/ 2>/dev/null || echo 000)
  if [ "$CODE" = "200" ]; then PRE_OK=1; break; fi
  kill -0 "$PRE_PID" 2>/dev/null || break
  sleep 1
done
echo "preflight pid=$PRE_PID ok=$PRE_OK http=$CODE"
echo "--- preflight log tail ---"
tail -25 "$PRE_LOG" 2>/dev/null || true
kill "$PRE_PID" 2>/dev/null; sleep 1; kill -9 "$PRE_PID" 2>/dev/null || true
if [ "$PRE_OK" != "1" ]; then
  echo "PREFLIGHT FAILED -- aborting, live service untouched"
  echo "==== abort $(date '+%F %T') ===="
  exit 1
fi
echo "preflight OK"

# ---------- stop old (port 43123) ----------
OLD_PID=$(pgrep -f "dsh/lib/bin.js web --host 127.0.0.1 --port 43123" | head -1)
echo "old pid: ${OLD_PID:-none}"
if [ -n "$OLD_PID" ]; then
  kill "$OLD_PID" 2>/dev/null || true
  for i in $(seq 1 50); do
    kill -0 "$OLD_PID" 2>/dev/null || break
    sleep 0.2
  done
  if kill -0 "$OLD_PID" 2>/dev/null; then
    echo "old process alive after SIGTERM, sending SIGKILL"
    kill -9 "$OLD_PID" 2>/dev/null || true
    sleep 1
  fi
fi
sleep 1

# ---------- start new (port 43123), detached ----------
echo "--- starting new dsh web on 43123 ---"
setsid "$NODE" "$DSH_BIN" web --host 127.0.0.1 --port 43123 >>"$MAIN_LOG" 2>&1 < /dev/null &
NEW_PID=$!
echo "new pid=$NEW_PID"
UP=0
for i in $(seq 1 60); do
  CODE=$(curl -sS -o /dev/null -w "%{http_code}" --max-time 2 http://127.0.0.1:43123/ 2>/dev/null || echo 000)
  if [ "$CODE" = "200" ]; then UP=1; break; fi
  kill -0 "$NEW_PID" 2>/dev/null || break
  sleep 1
done
echo "service up=$UP http=$CODE"
echo "--- new service log tail ---"
tail -15 "$MAIN_LOG" 2>/dev/null || true
echo "==== done $(date '+%F %T') ===="
