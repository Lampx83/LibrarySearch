#!/usr/bin/env bash
# Đóng gói ứng dụng LibrarySearch: build frontend + tạo zip phân phối.
# Chạy từ thư mục Tools/LibrarySearch: npm run pack   hoặc   ./scripts/pack.sh
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

VERSION=$(node -e "console.log(require('./package.json').version)")
OUT_NAME="LibrarySearch-${VERSION}"
ZIP_NAME="${OUT_NAME}.zip"
STAGE=".pack-stage"

echo "Building frontend (clean build)..."
rm -rf "$ROOT/dist"
rm -rf "$ROOT/node_modules/.vite"
npm run build

echo "Preparing package ${OUT_NAME}..."
rm -rf "$STAGE" "$ZIP_NAME"
mkdir -p "$STAGE/$OUT_NAME"
cd "$STAGE/$OUT_NAME"

# Frontend build
cp -r "$ROOT/dist" .

# Backend (exclude cache)
mkdir -p backend
cp "$ROOT/backend/main.py" backend/
cp "$ROOT/backend/requirements.txt" backend/
cp "$ROOT/backend/.env.example" backend/ 2>/dev/null || true
[ -d "$ROOT/backend/static" ] && cp -r "$ROOT/backend/static" backend/ 2>/dev/null || true

# Root files
cp "$ROOT/README.md" .
cp "$ROOT/package.json" .
cp "$ROOT/package-lock.json" . 2>/dev/null || true
cp "$ROOT/manifest.json" .
cp "$ROOT/.env.example" . 2>/dev/null || true
cp "$ROOT/.env.docker.example" . 2>/dev/null || true

# Docker
cp "$ROOT/docker-compose.yml" .
cp "$ROOT/Dockerfile" . 2>/dev/null || true
cp "$ROOT/nginx.conf" . 2>/dev/null || true
cp "$ROOT/.dockerignore" . 2>/dev/null || true
cp "$ROOT/backend/Dockerfile" backend/ 2>/dev/null || true

# RUN.txt hướng dẫn nhanh
cat > RUN.txt << 'RUN'
Chạy ứng dụng Tra cứu tài liệu thư viện
========================================

1) Chạy bằng Docker (khuyến nghị)
   docker-compose up -d
   Mở: http://localhost:3002
   Cấu hình thư mục dữ liệu: chỉnh LIBRARY_DATA_DIR trong docker-compose.yml hoặc .env

2) Chạy thủ công
   Backend:
     cd backend && pip install -r requirements.txt && uvicorn main:app --port 8001
   Frontend (phục vụ dist):
     npx serve -s dist -l 3002
   Hoặc dev: npm install && npm run dev (cần cả backend đang chạy)
   Cấu hình: copy backend/.env.example thành backend/.env, đặt LIBRARY_DATA_DIR

Chi tiết: xem README.md
RUN

cd "$ROOT/$STAGE"
zip -r "$ROOT/$ZIP_NAME" "$OUT_NAME" -x "*.DS_Store"
rm -rf "$ROOT/$STAGE"
echo "Done: $ROOT/$ZIP_NAME"
