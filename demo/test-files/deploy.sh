#!/usr/bin/env bash
# 部署脚本 — 测试 Shell 代码高亮
set -euo pipefail

APP_DIR="/opt/fruit-store"
VERSION="${1:-latest}"

echo "==> 部署 fruit-store ${VERSION}"

if [ ! -d "$APP_DIR" ]; then
  echo "错误: 目录不存在 $APP_DIR"
  exit 1
fi

cd "$APP_DIR"

# 拉取最新代码
git pull origin main

# 构建
if command -v npm &>/dev/null; then
  npm ci --production
  npm run build
fi

# 重启服务
systemctl restart fruit-store
systemctl status fruit-store --no-pager || true

echo "==> 部署完成"
