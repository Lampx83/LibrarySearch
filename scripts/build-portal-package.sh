#!/usr/bin/env bash
# Build frontend for Portal embed và tạo zip package để cài vào AI Portal.
# Chạy từ thư mục Tools/LibrarySearch: ./scripts/build-portal-package.sh
set -e
cd "$(dirname "$0")/.."
echo "Building for Portal embed..."
npm run build:portal
echo "Preparing package..."
OUT=portal-package
rm -rf "$OUT"
mkdir -p "$OUT/public"
cp manifest.json "$OUT"
cp dist/index.html "$OUT/public"
cp -r dist/assets "$OUT/public" 2>/dev/null || true
echo "Creating zip..."
ZIP=library-search-portal.zip
(cd "$OUT" && zip -r "../$ZIP" .)
rm -rf "$OUT"
echo "Done: $ZIP"
echo "Cài vào AI Portal: Admin → Cài đặt → Cài ứng dụng từ file → chọn $ZIP"
echo "Sau khi cài, vào Cài đặt công cụ → library-search → Thêm config: apiProxyTarget = http://localhost:8001 (hoặc URL backend LibrarySearch)."
