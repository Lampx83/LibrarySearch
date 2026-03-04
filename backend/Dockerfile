# Backend: FastAPI + pandas + openpyxl
FROM python:3.12-slim

WORKDIR /app

RUN apt-get update -qq && apt-get install -y --no-install-recommends \
    gcc \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Dữ liệu nhúng (Excel/CSV) — dùng khi không mount volume
COPY data /data

COPY main.py .

ENV LIBRARY_DATA_DIR=/data

EXPOSE 8001

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8001"]
