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

## Công cụ trong giao diện

- **Xuất CSV**: Tải danh sách kết quả hiện tại ra file CSV (UTF-8).
- **Sắp xếp**: Chuyển giữa sắp theo nguồn và sắp theo tên sách A→Z.
- **In**: In trang kết quả.
- **Chia sẻ**: Copy link tìm kiếm; mở link sẽ tự tìm theo từ khóa.
- **Trích dẫn APA**: Mỗi bản ghi có nút copy trích dẫn APA.
- **Phím tắt**: `/` focus tìm kiếm, `Esc` xóa.
- **Tải thêm**: Nút "Tải thêm kết quả" khi có đủ 150 bản ghi.

## Deploy lên Portainer (Docker)

Ứng dụng chạy độc lập (frontend + backend trong Docker), có thể deploy qua **Git repository** trong Portainer. Sau khi deploy, dùng URL này làm **API cho AI Portal** (apiProxyTarget).

### Cấu trúc Docker

- **frontend**: Build Vite → nginx serve static, proxy `/api` và `/health` tới backend. Cổng **8019** (HTTP_PORT).
- **backend**: FastAPI (Python), đọc Excel/CSV từ volume. Cổng **8020** (BACKEND_PORT) expose ra host để **AI Portal gọi API trực tiếp** tới địa chỉ `http://<host>:8020`.

### Deploy qua Git repository trong Portainer

1. Vào Portainer → **Stacks** → **Add stack**.
2. Đặt tên stack (vd. `library-search`).
3. Chọn **Git repository**:
   - **Repository URL**: `https://github.com/Lampx83/LibrarySearch.git`
   - **Compose path**: `docker-compose.yml`
   - **Branch**: `main`
4. (Tùy chọn) **Environment variables**:
   - `HTTP_PORT`: cổng frontend/giao diện (mặc định **8019**).
   - `BACKEND_PORT`: cổng backend/API (mặc định **8020**). AI Portal dùng URL `http://<host>:8020` để gọi API.
   - `LIBRARY_DATA_DIR`: trong container mặc định `/data` (volume được mount tại đây).
5. **Deploy the stack**.

### Dữ liệu Excel/CSV

Backend cần thư mục chứa file Excel/CSV. Hai cách:

**Cách 1: Bind mount thư mục host**

Sửa `docker-compose.yml` trong repo (hoặc dùng override): thay volume `library-data` của service `backend` bằng:

```yaml
volumes:
  - /đường/dẫn/trên/máy/chứa/file:/data
```

Đảm bảo `LIBRARY_DATA_DIR=/data` (mặc định).

**Cách 2: Named volume và copy file vào**

Sau khi stack chạy, copy file vào volume:

```bash
docker cp "/path/to/Danh mục ebook ProQuest.xlsx" library-search_backend_1:/data/
# ... copy các file còn lại
```

### Truy cập ứng dụng

- **Giao diện (frontend)**: `http://<máy-chủ>:8019` (vd. `http://101.96.66.232:8019`).
- **API (backend)**: `http://<máy-chủ>:8020` — dùng cho AI Portal (apiProxyTarget). VD: `http://101.96.66.232:8020`.

### Kết nối AI Portal với bản deploy trên Portainer

1. Trong AI Portal: **Cài đặt** → **Cài đặt công cụ** → tool **Tra cứu tài liệu thư viện** (đã cài từ package zip) → **Cấu hình**.
2. **API Proxy Target (URL)**: nhập **địa chỉ backend**, cổng **8020**, ví dụ:
   - `http://101.96.66.232:8020` (không thêm `/api` — Portal sẽ gọi `/api/sources`, `/api/search` tới URL này).
   - Hoặc `http://<IP-máy-chủ>:8020` nếu khác IP.
3. Lưu. Portal sẽ proxy mọi request từ iframe tới backend tại cổng 8020.

**Chạy bằng docker-compose tại máy (không dùng Portainer):**

```bash
git clone https://github.com/Lampx83/LibrarySearch.git
cd LibrarySearch
cp .env.docker.example .env
# Chỉnh .env: HTTP_PORT=8019, BACKEND_PORT=8020, LIBRARY_DATA_DIR (hoặc mount volume)
docker compose up -d --build
# Giao diện: http://localhost:8019 — API: http://localhost:8020
```

---

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
