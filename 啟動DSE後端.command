#!/bin/bash
set -u

PROJECT_DIR="/Users/jaydenlaw/Documents/AI数学运算后端开发"
PORT="3000"
LOG_FILE="$PROJECT_DIR/.claude-server.log"
APP_URL="http://localhost:${PORT}/dse-author"

cd "$PROJECT_DIR" || {
  echo "無法進入專案目錄：$PROJECT_DIR"
  read -r -p "按 Enter 關閉..." _
  exit 1
}

echo "[1/5] 檢查 Node.js..."
if ! command -v node >/dev/null 2>&1; then
  echo "找不到 node，請先安裝或確認 PATH。"
  read -r -p "按 Enter 關閉..." _
  exit 1
fi

echo "[2/5] 檢查 ${PORT} port..."
PIDS="$(lsof -ti tcp:${PORT} 2>/dev/null || true)"
if [ -n "$PIDS" ]; then
  echo "發現既有後端程序，正在停止：$PIDS"
  kill $PIDS 2>/dev/null || true

  for _ in {1..20}; do
    sleep 0.5
    if ! lsof -ti tcp:${PORT} >/dev/null 2>&1; then
      break
    fi
  done
fi

if lsof -ti tcp:${PORT} >/dev/null 2>&1; then
  echo "${PORT} port 仍被佔用，無法重啟。"
  echo "請先查看是哪個程序持續佔用：lsof -i tcp:${PORT}"
  read -r -p "按 Enter 關閉..." _
  exit 1
fi

echo "[3/5] 啟動後端..."
nohup node src/server/index.js > "$LOG_FILE" 2>&1 &
SERVER_PID=$!
echo "已送出啟動指令，PID：$SERVER_PID"

echo "[4/5] 等待服務就緒..."
READY=0
for _ in {1..40}; do
  if curl -fsS "$APP_URL" >/dev/null 2>&1; then
    READY=1
    break
  fi
  sleep 0.5
done

if [ "$READY" != "1" ]; then
  echo "後端啟動失敗或逾時。"
  echo "請查看 log：$LOG_FILE"
  if [ -f "$LOG_FILE" ]; then
    echo "----- 最近 log -----"
    tail -n 40 "$LOG_FILE"
    echo "--------------------"
  fi
  read -r -p "按 Enter 關閉..." _
  exit 1
fi

echo "[5/5] 打開瀏覽器：$APP_URL"
open "$APP_URL"
echo "完成。"
