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

## Deploy lên Portainer (Docker)

Ứng dụng chạy độc lập (frontend + backend trong Docker), có thể deploy qua **Git repository** trong Portainer. Sau khi deploy, dùng URL này làm **API cho AI Portal** (apiProxyTarget).

### Cấu trúc Docker

- **frontend**: Build Vite → nginx serve static, proxy `/api` và `/health` tới backend.
- **backend**: FastAPI (Python), đọc Excel/CSV từ volume hoặc thư mục mount.
- Một cổng duy nhất (mặc định **3002**): truy cập giao diện và API qua cùng URL.

### Deploy qua Git repository trong Portainer

1. Vào Portainer → **Stacks** → **Add stack**.
2. Đặt tên stack (vd. `library-search`).
3. Chọn **Git repository**:
   - **Repository URL**: `https://github.com/Lampx83/LibrarySearch.git`
   - **Compose path**: `docker-compose.yml`
   - **Branch**: `main`
4. (Tùy chọn) **Environment variables**:
   - `HTTP_PORT`: cổng trên host (mặc định `3002`).
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

- **Giao diện**: `http://<máy-chủ>:3002` (hoặc cổng bạn đặt `HTTP_PORT`).
- **API** (dùng cho AI Portal): cùng URL gốc, ví dụ `http://<máy-chủ>:3002` (không cần thêm `/api` khi cấu hình Portal).

### Kết nối AI Portal với bản deploy trên Portainer

1. Trong AI Portal: **Cài đặt** → **Cài đặt công cụ** → tool **Tra cứu tài liệu thư viện** (đã cài từ package zip) → **Cấu hình**.
2. **API Proxy Target (URL)**: nhập **URL gốc** của ứng dụng vừa deploy, ví dụ:
   - `http://192.168.1.100:3002` (nếu Portal và LibrarySearch cùng mạng),
   - hoặc `https://library-search.ten-mien-cua-ban.com` (nếu đã reverse proxy + HTTPS).
3. Lưu. Portal sẽ proxy mọi request từ iframe tới URL này (vd. `/api/sources`, `/api/search`).

**Chạy bằng docker-compose tại máy (không dùng Portainer):**

```bash
git clone https://github.com/Lampx83/LibrarySearch.git
cd LibrarySearch
cp .env.docker.example .env
# Chỉnh .env: HTTP_PORT, LIBRARY_DATA_DIR (hoặc mount volume trong docker-compose)
docker compose up -d --build
# Mở http://localhost:3002
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
