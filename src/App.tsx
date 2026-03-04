import { BookOpen, Search, Loader2, Copy, History, Sparkles, BookMarked, Download, ArrowUpDown, Printer, Share2, FileText } from "lucide-react"
import { useEffect, useState, useRef, useCallback, useMemo } from "react"

// Khi nhúng trong AI Portal: Portal inject window.__DATA_API_BASE__ = /base-path/api/apps/library-search
const API =
  (typeof window !== "undefined" && (window as unknown as { __DATA_API_BASE__?: string }).__DATA_API_BASE__) || "/api"
const DEBOUNCE_MS = 400
const SUGGEST_DEBOUNCE_MS = 220
const RECENT_KEY = "library-search-recent"
const MAX_RECENT = 8
const LIMIT = 150

type Source = { id: string; name: string; rows: number }
type SearchResult = Record<string, string>
type PerSource = { _source_id: string; _source_name: string; count: number }

// Cột ưu tiên hiển thị trước (tên sách, tác giả, nhan đề...)
const PRIORITY_KEYS = [
  "Tên sách",
  "Tên học phần",
  "Nhan đề",
  "Nhan ??", // CSV encoding variant
  "Title",
  "Tên tạp chí",
  "Tên tạp chí (cập nhật 2025)",
  "Tác giả",
  "Tác giả /\nlần xuất bản",
  "Tác giả khác",
  "Tác gi?",
  "Barcode",
  "ISBN",
  "EISBN",
  "eISBN",
  "eISBN13",
  "Chủ đề",
  "Ch? ??",
  "Ch? ??/T? khóa",
  "Thông tin xu?t b?n",
  "Thông tin xuất bản",
  "Năm XB",
  "Url",
]

function getDisplayKeys(row: SearchResult): string[] {
  const all = Object.keys(row).filter((k) => !k.startsWith("_") && row[k])
  const ordered: string[] = []
  for (const p of PRIORITY_KEYS) {
    if (all.includes(p)) ordered.push(p)
  }
  for (const k of all) {
    if (!ordered.includes(k)) ordered.push(k)
  }
  return ordered
}

// Highlight mọi từ khóa trong text (case-insensitive)
function highlightText(text: string, query: string): React.ReactNode {
  if (!query.trim()) return text
  const terms = query.trim().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return text
  const escaped = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  const re = new RegExp(escaped.join("|"), "gi")
  const parts: React.ReactNode[] = []
  let last = 0
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index))
    parts.push(
      <mark key={parts.length} className="bg-amber-200/80 rounded px-0.5">
        {match[0]}
      </mark>
    )
    last = re.lastIndex
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts.length > 0 ? <>{parts}</> : text
}

function getRecentQueries(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw) as string[]
    return Array.isArray(arr) ? arr.slice(0, MAX_RECENT) : []
  } catch {
    return []
  }
}

function saveRecentQuery(q: string) {
  const qq = q.trim().toLowerCase()
  if (!qq) return
  let recent = getRecentQueries().filter((x) => x !== qq)
  recent = [qq, ...recent].slice(0, MAX_RECENT)
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(recent))
  } catch {}
}

function getTitleAuthorSubject(row: SearchResult): { title: string; author: string; subject: string } {
  const titleKeys = ["Tên sách", "Title", "Nhan đề", "Nhan ??", "Tên tạp chí", "Tên học phần"]
  const authorKeys = ["Tác giả", "Tác giả /\nlần xuất bản", "Tác giả khác", "Tác gi?"]
  const subjectKeys = ["Chủ đề", "Ch? ??", "Ch? ??/T? khóa", "Subjects"]
  const get = (keys: string[]) => keys.map((k) => row[k]).filter(Boolean)[0] || ""
  return { title: get(titleKeys), author: get(authorKeys), subject: get(subjectKeys) }
}

function getRowTitle(row: SearchResult): string {
  return getTitleAuthorSubject(row).title || (Object.keys(row).filter((k) => !k.startsWith("_")).map((k) => row[k]).find((v) => typeof v === "string" && v.length > 0 && v.length < 500) as string) || "—"
}

function formatCitationAPA(row: SearchResult): string {
  const { title, author } = getTitleAuthorSubject(row)
  const year = row["Năm XB"] || row["Thông tin xuất bản"] || row["Thông tin xu?t b?n"] || ""
  const yearMatch = year.match(/\d{4}/)
  const pub = row["Nhà xuất bản"] || row["Publisher"] || ""
  const authorPart = author ? author.replace(/\s*\/\s*.*$/, "").trim() + "." : ""
  const yearPart = yearMatch ? ` (${yearMatch[0]}).` : "."
  const titlePart = (title || "—") + "."
  const pubPart = pub ? ` ${pub}.` : ""
  return authorPart + yearPart + " " + titlePart + pubPart
}

function exportResultsToCSV(results: SearchResult[], filename: string) {
  if (results.length === 0) return
  const allKeys = new Set<string>()
  results.forEach((r) => Object.keys(r).filter((k) => !k.startsWith("_")).forEach((k) => allKeys.add(k)))
  const headers = Array.from(allKeys)
  const BOM = "\uFEFF"
  const csvRows = [headers.map((h) => `"${String(h).replace(/"/g, '""')}"`).join(",")]
  results.forEach((r) => {
    csvRows.push(headers.map((h) => `"${String(r[h] || "").replace(/"/g, '""')}"`).join(","))
  })
  const blob = new Blob([BOM + csvRows.join("\n")], { type: "text/csv;charset=utf-8" })
  const a = document.createElement("a")
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
}

export default function App() {
  const [sources, setSources] = useState<Source[]>([])
  const [loadingSources, setLoadingSources] = useState(true)
  const [query, setQuery] = useState("")
  const [searchQuery, setSearchQuery] = useState("")
  const [sourceFilter, setSourceFilter] = useState<string>("")
  const [results, setResults] = useState<SearchResult[]>([])
  const [perSource, setPerSource] = useState<PerSource[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [recent, setRecent] = useState<string[]>([])
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [relatedByIndex, setRelatedByIndex] = useState<Record<number, SearchResult[]>>({})
  const [sortBy, setSortBy] = useState<"source" | "title">("source")
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const suggestDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const suggestBoxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch(API + "/sources")
      .then((r) => r.json())
      .then((data) => {
        setSources(data.sources || [])
        setLoadingSources(false)
      })
      .catch(() => {
        setError("Không kết nối được backend. Chạy: cd backend && uvicorn main:app --reload --port 8001")
        setLoadingSources(false)
      })
  }, [])

  useEffect(() => {
    if (sources.length > 0 && typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search)
      const q = params.get("q")?.trim()
      const src = params.get("source")?.trim()
      if (q && q.length >= 2) {
        setQuery(q)
        setSearchQuery(q)
        if (src) setSourceFilter(src)
        const sp = new URLSearchParams({ q, limit: String(LIMIT) })
        if (src) sp.set("source", src)
        setLoading(true)
        fetch(API + "/search?" + sp).then((r) => r.json()).then((d) => { setResults(d.results || []); setPerSource(d.per_source || []); setLoading(false) }).catch(() => setLoading(false))
      }
    }
  }, [sources.length])

  useEffect(() => {
    setRecent(getRecentQueries())
  }, [searchQuery])

  // Khi đổi nguồn mà đang có từ khóa → tìm lại
  useEffect(() => {
    if (searchQuery && sources.length > 0) doSearch(searchQuery, true)
  }, [sourceFilter])

  // Gợi ý khi gõ (autocomplete từ dữ liệu)
  useEffect(() => {
    if (suggestDebounceRef.current) clearTimeout(suggestDebounceRef.current)
    const q = query.trim()
    if (q.length < 1) {
      setSuggestions([])
      setShowSuggestions(false)
      return
    }
    suggestDebounceRef.current = setTimeout(() => {
      fetch(API + "/suggest?q=" + encodeURIComponent(q) + "&limit=12")
        .then((r) => r.json())
        .then((data) => {
          setSuggestions(data.suggestions || [])
          setShowSuggestions((data.suggestions?.length || 0) > 0)
        })
        .catch(() => setSuggestions([]))
    }, SUGGEST_DEBOUNCE_MS)
    return () => {
      if (suggestDebounceRef.current) clearTimeout(suggestDebounceRef.current)
    }
  }, [query])

  // Click ngoài để đóng dropdown gợi ý
  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (
        showSuggestions &&
        suggestBoxRef.current &&
        inputRef.current &&
        !suggestBoxRef.current.contains(e.target as Node) &&
        !inputRef.current.contains(e.target as Node)
      ) {
        setShowSuggestions(false)
      }
    }
    document.addEventListener("mousedown", onMouseDown)
    return () => document.removeEventListener("mousedown", onMouseDown)
  }, [showSuggestions])

  const doSearch = useCallback(
    (q: string, appendSource?: boolean, limitOverride?: number) => {
      const term = q.trim()
      if (!term) return
      setSearchQuery(term)
      setLoading(true)
      setError(null)
      const params = new URLSearchParams({ q: term, limit: String(limitOverride ?? LIMIT) })
      if (appendSource && sourceFilter) params.set("source", sourceFilter)
      fetch(API + "/search?" + params)
        .then((r) => {
          if (!r.ok) throw new Error(r.statusText)
          return r.json()
        })
        .then((data) => {
          setResults(data.results || [])
          setPerSource(data.per_source || [])
          setLoading(false)
          saveRecentQuery(term)
        })
        .catch((e) => {
          setError(e.message || "Lỗi tìm kiếm")
          setResults([])
          setPerSource([])
          setLoading(false)
        })
    },
    [sourceFilter]
  )

  // Tìm khi gõ (debounce)
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const q = query.trim()
    if (q.length < 2) {
      if (searchQuery && q.length === 0) {
        setSearchQuery("")
        setResults([])
        setPerSource([])
      }
      return
    }
    debounceRef.current = setTimeout(() => {
      doSearch(q, true)
    }, DEBOUNCE_MS)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query])

  const copyRow = (row: SearchResult) => {
    const keys = getDisplayKeys(row)
    const text = keys.map((k) => `${k}: ${row[k]}`).join("\n")
    navigator.clipboard.writeText(text).then(() => {})
  }

  const fetchRelated = (idx: number, row: SearchResult) => {
    if (relatedByIndex[idx] !== undefined) return
    const { title, author, subject } = getTitleAuthorSubject(row)
    if (!author && !subject) return
    const params = new URLSearchParams({
      source_id: row._source_id || "",
      author: author,
      subject: subject,
      title: title,
      limit: "8",
    })
    fetch(API + "/related?" + params)
      .then((r) => r.json())
      .then((data) => {
        setRelatedByIndex((prev) => ({ ...prev, [idx]: data.results || [] }))
      })
      .catch(() => setRelatedByIndex((prev) => ({ ...prev, [idx]: [] })))
  }

  const totalRows = sources.reduce((a, s) => a + s.rows, 0)

  const sortedResults = useMemo(() => {
    if (sortBy === "title") {
      return [...results].sort((a, b) => getRowTitle(a).localeCompare(getRowTitle(b), "vi"))
    }
    return results
  }, [results, sortBy])

  const shareUrl =
    typeof window !== "undefined" && searchQuery
      ? `${window.location.origin}${window.location.pathname}?q=${encodeURIComponent(searchQuery)}${sourceFilter ? "&source=" + encodeURIComponent(sourceFilter) : ""}`
      : ""

  const copyShareLink = () => {
    if (shareUrl) navigator.clipboard.writeText(shareUrl)
  }

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "/" && !/^(input|textarea)$/i.test((e.target as HTMLElement)?.tagName)) {
        e.preventDefault()
        inputRef.current?.focus()
      }
      if (e.key === "Escape") {
        setShowSuggestions(false)
        if (document.activeElement === inputRef.current) {
          setQuery("")
          setSearchQuery("")
          setResults([])
          setPerSource([])
        }
      }
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [])

  return (
    <div className="min-h-screen bg-stone-100/80 text-stone-800">
      <header className="bg-gradient-to-br from-emerald-700 to-emerald-800 text-white shadow-sm">
        <div className="max-w-3xl mx-auto px-4 py-5 sm:py-6">
          <div className="flex items-start gap-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/15">
              <BookOpen className="h-6 w-6" />
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="text-lg font-semibold tracking-tight sm:text-xl">Tra cứu tài liệu thư viện</h1>
              <p className="mt-0.5 text-sm text-emerald-100/90">Sách, tạp chí, ebook — ProQuest, Springer, Elsevier, Sách in</p>
              <p className="mt-1.5 text-xs text-emerald-200/70 print:hidden">Phím tắt: / focus · Esc xóa</p>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 pb-10 pt-6 sm:pt-8">
        {/* Ô tìm kiếm — luôn nổi bật */}
        <div className="relative rounded-2xl bg-white p-4 shadow-[var(--app-shadow)] ring-1 ring-stone-200/80 sm:p-5" ref={suggestBoxRef}>
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-stone-400 pointer-events-none" />
            <input
              ref={inputRef}
              type="text"
              placeholder="Tên sách, tác giả, chủ đề hoặc barcode…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  setShowSuggestions(false)
                  doSearch(query.trim(), true)
                }
              }}
              className="h-12 w-full rounded-xl border border-stone-200 bg-stone-50/50 pl-10 pr-10 text-base text-stone-800 placeholder:text-stone-400 focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/20 outline-none transition-colors"
              autoFocus
            />
            {loading && (
              <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-stone-400">
                <Loader2 className="h-5 w-5 animate-spin" />
              </span>
            )}
          </div>
          {showSuggestions && suggestions.length > 0 && (
            <div className="absolute left-0 right-0 top-full z-50 mt-1.5 max-h-56 overflow-auto rounded-xl border border-stone-200 bg-white shadow-lg ring-1 ring-stone-200/80">
              <p className="border-b border-stone-100 px-3 py-2 text-xs font-medium text-stone-500">Gợi ý từ kho — chọn để tìm</p>
              <ul className="py-1">
                {suggestions.map((s, i) => (
                  <li key={i}>
                    <button
                      type="button"
                      className="w-full px-3 py-2.5 text-left text-sm text-stone-700 hover:bg-emerald-50/80"
                      onClick={() => {
                        if (debounceRef.current) clearTimeout(debounceRef.current)
                        setQuery(s)
                        setShowSuggestions(false)
                        doSearch(s, true)
                      }}
                    >
                      {s.length > 72 ? s.slice(0, 72) + "…" : s}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Gợi ý nhanh + Lịch sử */}
        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl bg-white/80 px-4 py-3 ring-1 ring-stone-200/60">
          <span className="flex items-center gap-1.5 text-xs font-medium text-stone-500"><Sparkles className="h-3.5 w-3.5" /> Thử</span>
          {["economics", "kinh tế", "NV02007", "Springer", "marketing"].map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                if (debounceRef.current) clearTimeout(debounceRef.current)
                setQuery(s)
                doSearch(s, true)
              }}
              className="rounded-lg bg-stone-100 px-2.5 py-1.5 text-xs font-medium text-stone-600 hover:bg-emerald-100 hover:text-emerald-800"
            >
              {s}
            </button>
          ))}
          {recent.length > 0 && (
            <>
              <span className="ml-1 flex items-center gap-1.5 text-xs text-stone-400"><History className="h-3.5 w-3.5" /> Gần đây</span>
              {recent.slice(0, 4).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => { if (debounceRef.current) clearTimeout(debounceRef.current); setQuery(r); doSearch(r, true) }}
                  className="rounded-lg bg-stone-50 px-2.5 py-1.5 text-xs text-stone-500 hover:bg-emerald-50 hover:text-stone-700"
                >
                  {r}
                </button>
              ))}
            </>
          )}
        </div>

        {/* Lọc nguồn */}
        {!loadingSources && sources.length > 0 && (
          <div className="mt-5 rounded-xl bg-white/80 p-3 ring-1 ring-stone-200/60 sm:p-4">
            <p className="mb-2.5 text-xs font-medium text-stone-500">Nguồn dữ liệu</p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setSourceFilter("")}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium ${!sourceFilter ? "bg-emerald-600 text-white shadow-sm" : "bg-stone-100 text-stone-600 hover:bg-stone-200"}`}
              >
                Tất cả ({totalRows.toLocaleString()})
              </button>
              {sources.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSourceFilter(sourceFilter === s.id ? "" : s.id)}
                  className={`max-w-[11rem] truncate rounded-lg px-3 py-1.5 text-xs font-medium ${sourceFilter === s.id ? "bg-emerald-600 text-white shadow-sm" : "bg-stone-100 text-stone-600 hover:bg-stone-200"}`}
                  title={s.name}
                >
                  {s.name.replace(/\(Sheet1\)$/, "")} ({s.rows})
                </button>
              ))}
            </div>
          </div>
        )}

        {error && (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{error}</div>
        )}

        {/* Số kết quả theo nguồn */}
        {searchQuery && perSource.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-stone-500">
            {perSource.map((p) => (
              <span key={p._source_id}><span className="font-medium text-stone-600">{p._source_name}</span> {p.count}</span>
            ))}
          </div>
        )}

        {/* Kết quả */}
        {searchQuery && (
          <section className="mt-6">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
              <h2 className="text-base font-semibold text-stone-700">
                Kết quả &quot;{searchQuery}&quot; · {results.length} bản ghi
              </h2>
              <div className="flex flex-wrap items-center gap-1.5 print:hidden">
                <button type="button" onClick={() => exportResultsToCSV(results, `tra-cuu-${searchQuery.slice(0, 30).replace(/\s+/g, "-")}.csv`)} disabled={results.length === 0} className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-xs font-medium text-stone-600 hover:bg-stone-50 disabled:opacity-50" title="Xuất CSV"><Download className="h-4 w-4" /> CSV</button>
                <button type="button" onClick={() => setSortBy(sortBy === "title" ? "source" : "title")} className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-xs font-medium text-stone-600 hover:bg-stone-50" title="Sắp xếp"><ArrowUpDown className="h-4 w-4" /> {sortBy === "title" ? "A→Z" : "Nguồn"}</button>
                <button type="button" onClick={() => window.print()} disabled={results.length === 0} className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-xs font-medium text-stone-600 hover:bg-stone-50 disabled:opacity-50" title="In"><Printer className="h-4 w-4" /> In</button>
                <button type="button" onClick={copyShareLink} disabled={!shareUrl} className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-xs font-medium text-stone-600 hover:bg-stone-50 disabled:opacity-50" title="Chia sẻ link"><Share2 className="h-4 w-4" /> Chia sẻ</button>
              </div>
            </div>
            {results.length === 0 && !loading && (
              <div className="rounded-xl border border-stone-200 bg-stone-50/50 py-14 text-center text-sm text-stone-500">
                Không có bản ghi nào chứa từ khóa này. Thử từ khác hoặc bỏ bớt từ.
              </div>
            )}
            <div className="mt-4 space-y-4">
              {sortedResults.map((row) => {
                const originalIdx = results.indexOf(row)
                return (
                <article
                  key={originalIdx}
                  className="rounded-xl border border-stone-200 bg-white p-4 shadow-[var(--app-shadow)] ring-1 ring-stone-200/50 transition-shadow hover:shadow-[var(--app-shadow-md)] hover:ring-stone-200/80 print:break-inside-avoid"
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="inline-flex rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200/60">
                      {row._source_name}
                    </span>
                    <div className="flex items-center gap-0.5">
                      <button type="button" onClick={() => navigator.clipboard.writeText(formatCitationAPA(row))} className="p-1.5 rounded-lg text-stone-400 hover:bg-stone-100 hover:text-stone-600 print:hidden" title="Copy trích dẫn APA">
                        <FileText className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => copyRow(row)}
                        className="p-1.5 rounded-lg text-stone-400 hover:bg-stone-100 hover:text-stone-600"
                        title="Sao chép"
                      >
                        <Copy className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  <dl className="mt-3 grid gap-2 text-sm">
                    {getDisplayKeys(row).map((key) => (
                      <div key={key} className="flex gap-3">
                        <dt className="w-28 shrink-0 text-stone-500">{key}:</dt>
                        <dd className="min-w-0 text-stone-800 break-words">
                          {highlightText(row[key], searchQuery)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                  {/* Gợi ý sách liên quan (cùng tác giả / chủ đề) */}
                  {(() => {
                    const { author, subject } = getTitleAuthorSubject(row)
                    const hasAuthorOrSubject = author.length >= 2 || subject.length >= 2
                    const related = relatedByIndex[originalIdx]
                    if (!hasAuthorOrSubject) return null
                    return (
                      <div className="mt-4 border-t border-stone-100 pt-3">
                        <button
                          type="button"
                          onClick={() => fetchRelated(originalIdx, row)}
                          className="flex items-center gap-1.5 text-sm font-medium text-emerald-600 hover:text-emerald-700"
                        >
                          <BookMarked className="h-4 w-4" />
                          {related === undefined ? "Gợi ý sách liên quan" : `Sách liên quan (${related.length})`}
                        </button>
                        {Array.isArray(related) && related.length > 0 && (
                          <ul className="mt-2 space-y-2">
                            {related.slice(0, 6).map((r, i) => (
                              <li key={i} className="border-l-2 border-emerald-100 pl-3 text-sm">
                                <span className="font-medium text-emerald-700">{r._source_name}</span>
                                <p className="truncate text-stone-600" title={getRowTitle(r)}>{getRowTitle(r)}</p>
                              </li>
                            ))}
                          </ul>
                        )}
                        {Array.isArray(related) && related.length === 0 && (
                          <p className="mt-1 pl-3 text-xs text-stone-400">Chưa tìm thấy sách liên quan khác.</p>
                        )}
                      </div>
                    )
                  })()}
                </article>
              )
              })}
            </div>
            {results.length === LIMIT && searchQuery && (
              <div className="mt-6 text-center print:hidden">
                <button
                  type="button"
                  onClick={() => doSearch(searchQuery, true, 400)}
                  disabled={loading}
                  className="rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50"
                >
                  {loading ? "Đang tải…" : "Tải thêm kết quả"}
                </button>
              </div>
            )}
          </section>
        )}

        {!searchQuery && query.length < 2 && (
          <p className="py-10 text-center text-sm text-stone-400">
            Gõ ít nhất 2 ký tự để tìm trong {totalRows.toLocaleString()} bản ghi
          </p>
        )}
      </main>
    </div>
  )
}
