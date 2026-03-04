"""
Backend API tra cứu tài liệu thư viện.
Đọc các file Excel/CSV từ thư mục cấu hình và cung cấp API tìm kiếm.
"""
from pathlib import Path
from typing import Any
import os
import re
import unicodedata

import pandas as pd
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

load_dotenv()

# Thư mục chứa file Excel/CSV (có thể override bằng env)
DATA_DIR = os.environ.get(
    "LIBRARY_DATA_DIR",
    "/Users/mac/Library/CloudStorage/SynologyDrive-education/000_inbox/Library/Tra cứu tài liệu",
)

# Danh sách file mặc định (tên file)
DEFAULT_FILES = [
    "Danh mục ebook & eTextbook ProQuest.xlsx",
    "Ebook Springer.xlsx",
    "Elsevier.xlsx",
    "Emerald Insight.xlsx",
    "IGPublishing.xlsx",
    "Journal SAGE.xlsx",
    "ProQuest Central NEU.xlsx",
    "Sách in ngoại văn(Sheet1).csv",
    "Sách in Việt văn(Sheet1).csv",
]

app = FastAPI(title="Tra cứu tài liệu thư viện", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Cache: { "source_id": { "name": str, "df": DataFrame } }
_sources: dict[str, dict[str, Any]] = {}

# Gợi ý thông minh: danh sách chuỗi (tên sách, tác giả, chủ đề) để autocomplete
_suggestion_terms: list[str] = []
MAX_SUGGESTION_TERMS = 35_000
SUGGESTION_COLUMN_PATTERNS = {
    "title": ["tên sách", "title", "nhan đề", "nhan de", "tên tạp chí", "tên học phần", "nhan ??", "nhan de"],
    "author": ["tác giả", "tac gia", "author", "tác giả khác", "tác gi?"],
    "subject": ["chủ đề", "chu de", "subject", "subjects", "từ khóa", "tu khoa", "ch? ??", "ch? ??/t? khóa"],
}


def _normalize_text(s: str) -> str:
    """Chuẩn hóa Unicode (NFC) để tìm kiếm tiếng Việt chính xác."""
    if not s or not isinstance(s, str):
        return ""
    return unicodedata.normalize("NFC", str(s).strip().lower())


def _safe_read_csv(path: Path) -> pd.DataFrame | None:
    # Thử cp1258 (Vietnamese Windows), utf-8, cp1252 để đọc đúng tiếng Việt
    for encoding in ("cp1258", "utf-8", "utf-8-sig", "cp1252", "latin1"):
        try:
            df = pd.read_csv(
                path,
                encoding=encoding,
                on_bad_lines="skip",
                low_memory=False,
            )
            if df.empty or len(df.columns) < 2:
                continue
            return df
        except Exception:
            continue
    return None


def _safe_read_excel(path: Path) -> pd.DataFrame | None:
    try:
        df = pd.read_excel(path, engine="openpyxl", header=0)
        if df.empty:
            return None
        return df
    except Exception:
        return None


def _load_sources() -> dict[str, dict[str, Any]]:
    global _sources
    if _sources:
        return _sources
    root = Path(DATA_DIR)
    if not root.exists():
        return {}
    for i, filename in enumerate(DEFAULT_FILES):
        path = root / filename
        if not path.exists():
            continue
        name = path.stem
        df = None
        if path.suffix.lower() == ".csv":
            df = _safe_read_csv(path)
        elif path.suffix.lower() in (".xlsx", ".xls"):
            df = _safe_read_excel(path)
        if df is not None and not df.empty:
            # Chuẩn hóa: mọi cột thành chuỗi, không để nan; chuẩn Unicode
            for c in df.columns:
                col = df[c].fillna("").astype(str)
                col = col.str.strip().replace(r"^nan$", "", regex=True)
                df[c] = col
            source_id = str(i) + "_" + re.sub(r"[^\w\-]", "_", name)[:40]
            _sources[source_id] = {"name": name, "df": df}
    _build_suggestion_terms()
    return _sources


def _col_matches_pattern(col_name: str, patterns: list[str]) -> bool:
    cn = _normalize_text(col_name)
    return any(p in cn or cn in p for p in patterns)


def _build_suggestion_terms() -> None:
    global _suggestion_terms
    if _suggestion_terms:
        return
    seen: set[str] = set()
    out: list[str] = []
    for data in _sources.values():
        df = data["df"]
        title_cols = [c for c in df.columns if _col_matches_pattern(str(c), SUGGESTION_COLUMN_PATTERNS["title"])]
        author_cols = [c for c in df.columns if _col_matches_pattern(str(c), SUGGESTION_COLUMN_PATTERNS["author"])]
        subject_cols = [c for c in df.columns if _col_matches_pattern(str(c), SUGGESTION_COLUMN_PATTERNS["subject"])]
        for _, row in df.iterrows():
            if len(out) >= MAX_SUGGESTION_TERMS:
                break
            for c in title_cols + author_cols + subject_cols:
                val = row.get(c)
                if pd.isna(val) or not str(val).strip():
                    continue
                s = str(val).strip()
                if len(s) < 2 or len(s) > 300:
                    continue
                for part in re.split(r"[;,]|\s*/\s*", s):
                    part = part.strip()
                    if 2 <= len(part) <= 200 and part.lower() not in seen:
                        seen.add(part.lower())
                        out.append(part)
                        if len(out) >= MAX_SUGGESTION_TERMS:
                            break
            if len(out) >= MAX_SUGGESTION_TERMS:
                break
    _suggestion_terms = out


def _row_to_record(source_id: str, source_name: str, row: pd.Series) -> dict:
    rec = {"_source_id": source_id, "_source_name": source_name}
    for k, v in row.items():
        val = str(v).strip() if pd.notna(v) else ""
        if val and val.lower() != "nan":
            rec[str(k).strip()] = val
    return rec


@app.get("/health")
def health():
    return {"status": "ok", "service": "library-search"}


@app.get("/api/sources")
def list_sources():
    """Liệt kê các nguồn dữ liệu đã load."""
    sources = _load_sources()
    return {
        "data_dir": DATA_DIR,
        "sources": [
            {"id": sid, "name": data["name"], "rows": len(data["df"])}
            for sid, data in sources.items()
        ],
    }


@app.get("/api/search")
def search(
    q: str = Query(..., min_length=1),
    source: str | None = Query(None, description="Lọc theo source_id"),
    limit: int = Query(100, ge=1, le=500),
):
    """
    Tìm kiếm trong tất cả cột của các file.
    """
    sources = _load_sources()
    if not sources:
        raise HTTPException(
            status_code=503,
            detail=f"Chưa load được nguồn nào. Kiểm tra LIBRARY_DATA_DIR: {DATA_DIR}",
        )
    q_lower = _normalize_text(q)
    if not q_lower:
        return {"query": q, "total": 0, "results": []}

    # Tìm kiếm: chuẩn hóa Unicode, escape ký tự đặc biệt regex
    # Nhiều từ khóa: tách theo khoảng trắng, bản ghi phải chứa TẤT CẢ từ (mỗi từ có thể ở cột khác nhau)
    terms = [t for t in q_lower.split() if len(t) >= 1]
    if not terms:
        return {"query": q, "total": 0, "results": [], "per_source": []}
    terms_escaped = [re.escape(t) for t in terms]
    results: list[dict] = []
    per_source: list[dict] = []

    for sid, data in sources.items():
        if source and sid != source:
            continue
        df = data["df"]
        name = data["name"]
        # Với mỗi từ: ít nhất một cột chứa từ đó => term_mask. Kết quả: tất cả term_mask đều True.
        mask = pd.Series([True] * len(df), index=df.index)
        for term in terms_escaped:
            term_found = pd.Series([False] * len(df), index=df.index)
            for col in df.columns:
                normalized = df[col].fillna("").astype(str).str.strip()
                normalized = normalized.apply(lambda x: _normalize_text(x) if x else "")
                term_found |= normalized.str.contains(term, na=False, regex=True)
            mask &= term_found
        hits = df[mask]
        count = 0
        remaining = limit - len(results)
        for _, row in hits.head(remaining).iterrows():
            results.append(_row_to_record(sid, name, row))
            count += 1
            if len(results) >= limit:
                break
        if len(hits) > 0:
            per_source.append({"_source_id": sid, "_source_name": name, "count": len(hits)})
        if len(results) >= limit:
            break

    return {"query": q, "total": len(results), "results": results, "per_source": per_source}


class SearchBody(BaseModel):
    q: str
    source: str | None = None
    limit: int = 100


@app.post("/api/search")
def search_post(body: SearchBody):
    return search(q=body.q, source=body.source, limit=min(body.limit, 500))


@app.get("/api/suggest")
def suggest(
    q: str = Query(..., min_length=1),
    limit: int = Query(15, ge=1, le=30),
):
    """Gợi ý từ khóa từ dữ liệu thật (tên sách, tác giả, chủ đề)."""
    _load_sources()
    if not _suggestion_terms:
        return {"suggestions": []}
    q_norm = _normalize_text(q)
    if not q_norm:
        return {"suggestions": []}
    out: list[str] = []
    for term in _suggestion_terms:
        if q_norm in _normalize_text(term):
            out.append(term)
            if len(out) >= limit:
                break
    return {"suggestions": out}


def _get_author_subject_keys(df: pd.DataFrame) -> tuple[list[str], list[str]]:
    author_cols = [c for c in df.columns if _col_matches_pattern(str(c), SUGGESTION_COLUMN_PATTERNS["author"])]
    subject_cols = [c for c in df.columns if _col_matches_pattern(str(c), SUGGESTION_COLUMN_PATTERNS["subject"])]
    return author_cols, subject_cols


@app.get("/api/related")
def related(
    source_id: str = Query(..., description="Nguồn của bản ghi gốc"),
    author: str = Query(""),
    subject: str = Query(""),
    title: str = Query("", description="Nhan đề/tên sách để loại trừ bản ghi trùng"),
    limit: int = Query(8, ge=1, le=20),
):
    """Gợi ý sách liên quan: cùng tác giả hoặc cùng chủ đề, bỏ qua bản ghi trùng title."""
    sources = _load_sources()
    if source_id not in sources:
        return {"results": []}
    author = (author or "").strip()
    subject = (subject or "").strip()
    title_exclude = _normalize_text(title or "")
    if not author and not subject:
        return {"results": []}
    author_parts = [t for t in re.split(r"[;,/\s]+", author) if len(t) >= 2]
    subject_parts = [t for t in re.split(r"[;,/\s]+", subject) if len(t) >= 2]
    results: list[dict] = []
    for sid, data in sources.items():
        df = data["df"]
        name = data["name"]
        author_cols, subject_cols = _get_author_subject_keys(df)
        for _, row in df.iterrows():
            if len(results) >= limit:
                break
            row_title = ""
            for c in df.columns:
                cn = _normalize_text(str(c))
                if "sách" in cn or "title" in cn or "nhan" in cn or "tên tạp chí" in cn:
                    row_title = str(row.get(c, "")).strip()
                    break
            if title_exclude and _normalize_text(row_title) == title_exclude:
                continue
            match = False
            if author_parts:
                for c in author_cols:
                    cell = _normalize_text(str(row.get(c, "")))
                    for ap in author_parts:
                        if ap in cell:
                            match = True
                            break
            if not match and subject_parts:
                for c in subject_cols:
                    cell = _normalize_text(str(row.get(c, "")))
                    for sp in subject_parts:
                        if sp in cell:
                            match = True
                            break
            if match:
                results.append(_row_to_record(sid, name, row))
    return {"results": results[:limit]}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
