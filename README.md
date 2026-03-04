# Tra cứu tài liệu thư viện

Ứng dụng tra cứu thông tin từ các file Excel/CSV tài liệu thư viện: ProQuest, Springer, Elsevier, Emerald, SAGE, IGPublishing, Sách in ngoại văn, Sách in Việt văn.

## Yêu cầu

- Node.js 18+
- Python 3.10+ (backend)
- Các file dữ liệu nằm trong thư mục cấu hình (mặc định: Synology Drive – Tra cứu tài liệu)

## Cấu hình

1. Copy `.env.example` thành `.env` (trong thư mục `backend` hoặc root).
2. Chỉnh `LIBRARY_DATA_DIR` trỏ tới thư mục chứa các file:
   - `Danh mục ebook & eTextbook ProQuest.xlsx`
   - `Ebook Springer.xlsx`
   - `Elsevier.xlsx`
   - `Emerald Insight.xlsx`
   - `IGPublishing.xlsx`
   - `Journal SAGE.xlsx`
   - `ProQuest Central NEU.xlsx`
   - `Sách in ngoại văn(Sheet1).csv`
   - `Sách in Việt văn(Sheet1).csv`

## Chạy ứng dụng

### Cài đặt

```bash
cd Tools/LibrarySearch
npm install
cd backend && pip install -r requirements.txt   # hoặc: pip install pandas openpyxl fastapi uvicorn python-dotenv
```

### Chạy (frontend + backend)

```bash
# Từ thư mục Tools/LibrarySearch
npm run start
```

- Frontend: http://localhost:3002  
- Backend API: http://localhost:8001  

### Chạy riêng từng phần

**Backend:**

```bash
cd backend
export LIBRARY_DATA_DIR="/đường/dẫn/tới/Tra cứu tài liệu"  # nếu cần
uvicorn main:app --reload --port 8001
```

**Frontend (sau khi backend đã chạy):**

```bash
npm run dev
```

## API

- `GET /api/sources` – Danh sách nguồn đã load và số dòng.
- `GET /api/search?q=<từ khóa>&source=<source_id>&limit=100` – Tìm kiếm trong tất cả cột.
- `POST /api/search` – Body JSON: `{ "q": "từ khóa", "source": null, "limit": 100 }`.

Tìm kiếm không phân biệt hoa thường, tìm trong mọi cột (nhan đề, tác giả, chủ đề, barcode, v.v.).

## Đóng gói và đưa lên AI Portal

Ứng dụng có thể được nhúng vào AI Portal dưới dạng **tool (frontend-only)**. Portal hiển thị trong sidebar và mở giao diện trong iframe; API được proxy qua Portal tới backend Python.

### Bước 1: Build package

```bash
cd Tools/LibrarySearch
npm run build:portal
./scripts/build-portal-package.sh
```

Sẽ tạo file `library-search-portal.zip`.

### Bước 2: Cài vào AI Portal

1. Đăng nhập AI Portal với tài khoản admin.
2. Vào **Cài đặt** → **Cài đặt ứng dụng từ file** → chọn `library-search-portal.zip` → Cài đặt.
3. Vào **Cài đặt công cụ** → chọn tool **Tra cứu tài liệu thư viện** (alias: `library-search`) → **Chỉnh sửa**.
4. Trong **config_json** thêm key: `apiProxyTarget` = URL backend LibrarySearch (vd. `http://localhost:8001` hoặc `https://library-api.example.com`). Lưu.

### Bước 3: Chạy backend LibrarySearch

Backend Python phải chạy và truy cập được từ máy chạy Portal. Portal proxy request từ iframe tới URL này.

```bash
cd Tools/LibrarySearch/backend
python3 -m uvicorn main:app --reload --port 8001
```

Sau đó trong Portal: **Công cụ** → **Tra cứu tài liệu thư viện**.
