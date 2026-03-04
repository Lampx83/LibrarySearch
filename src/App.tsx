import { BookOpen, Search, Loader2, Copy, History, Sparkles, BookMarked } from "lucide-react"
import { useEffect, useState, useRef, useCallback } from "react"

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
    (q: string, appendSource?: boolean) => {
      const term = q.trim()
      if (!term) return
      setSearchQuery(term)
      setLoading(true)
      setError(null)
      const params = new URLSearchParams({ q: term, limit: String(LIMIT) })
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

  return (
    <div className="min-h-screen bg-stone-50 text-stone-800">
      <header className="bg-emerald-800 text-white shadow">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center gap-3">
          <BookOpen className="w-8 h-8 shrink-0" />
          <div className="min-w-0">
            <h1 className="text-xl font-semibold">Tra cứu tài liệu thư viện</h1>
            <p className="text-emerald-100 text-sm truncate">
              Gõ từ khóa — tìm trong sách, tạp chí, ebook (ProQuest, Springer, Elsevier, Sách in...)
            </p>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-5">
        {/* Ô tìm kiếm — luôn nổi bật */}
        <div className="relative mb-4" ref={suggestBoxRef}>
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-stone-400 pointer-events-none" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Tên sách, tác giả, chủ đề, barcode... (gõ 2 ký tự trở lên để tìm)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                setShowSuggestions(false)
                doSearch(query.trim(), true)
              }
            }}
            className="w-full pl-10 pr-4 py-3 rounded-xl border border-stone-300 bg-white shadow-sm focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 outline-none text-base"
            autoFocus
          />
          {loading && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400">
              <Loader2 className="w-5 h-5 animate-spin" />
            </span>
          )}
          {/* Dropdown gợi ý thông minh từ dữ liệu */}
          {showSuggestions && suggestions.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-1 rounded-xl border border-stone-200 bg-white shadow-lg z-50 max-h-64 overflow-y-auto">
              <div className="p-2 border-b border-stone-100 text-xs text-stone-500">
                Gợi ý từ kho tài liệu — chọn để tìm
              </div>
              <ul className="py-1">
                {suggestions.map((s, i) => (
                  <li key={i}>
                    <button
                      type="button"
                      className="w-full text-left px-4 py-2.5 text-sm hover:bg-emerald-50 text-stone-800"
                      onClick={() => {
                        if (debounceRef.current) clearTimeout(debounceRef.current)
                        setQuery(s)
                        setShowSuggestions(false)
                        doSearch(s, true)
                      }}
                    >
                      {s.length > 80 ? s.slice(0, 80) + "…" : s}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Gợi ý nhanh + Lịch sử */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <span className="text-stone-500 text-sm flex items-center gap-1">
            <Sparkles className="w-4 h-4" /> Thử:
          </span>
          {["economics", "kinh tế", "NV02007", "Springer", "marketing"].map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                if (debounceRef.current) clearTimeout(debounceRef.current)
                setQuery(s)
                doSearch(s, true)
              }}
              className="text-sm px-3 py-1.5 rounded-full bg-stone-200/80 hover:bg-emerald-100 text-stone-700 hover:text-emerald-800 transition-colors"
            >
              {s}
            </button>
          ))}
          {recent.length > 0 && (
            <>
              <span className="text-stone-400 text-sm ml-2 flex items-center gap-1">
                <History className="w-4 h-4" /> Gần đây:
              </span>
              {recent.slice(0, 4).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => {
                    if (debounceRef.current) clearTimeout(debounceRef.current)
                    setQuery(r)
                    doSearch(r, true)
                  }}
                  className="text-sm px-3 py-1.5 rounded-full bg-stone-100 hover:bg-emerald-50 text-stone-600"
                >
                  {r}
                </button>
              ))}
            </>
          )}
        </div>

        {/* Lọc nguồn — dạng pills */}
        {!loadingSources && sources.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 mb-5">
            <span className="text-stone-500 text-sm shrink-0">Nguồn:</span>
            <button
              type="button"
              onClick={() => setSourceFilter("")}
              className={`text-sm px-3 py-1.5 rounded-full transition-colors ${!sourceFilter ? "bg-emerald-600 text-white" : "bg-stone-200/80 text-stone-600 hover:bg-stone-300"}`}
            >
              Tất cả ({totalRows.toLocaleString()})
            </button>
            {sources.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSourceFilter(sourceFilter === s.id ? "" : s.id)}
                className={`text-sm px-3 py-1.5 rounded-full transition-colors truncate max-w-[180px] ${sourceFilter === s.id ? "bg-emerald-600 text-white" : "bg-stone-200/80 text-stone-600 hover:bg-stone-300"}`}
                title={s.name}
              >
                {s.name.replace(/\(Sheet1\)$/, "")} ({s.rows})
              </button>
            ))}
          </div>
        )}

        {error && (
          <div className="mb-4 p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-sm">
            {error}
          </div>
        )}

        {/* Số kết quả theo nguồn */}
        {searchQuery && perSource.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-3 text-sm">
            {perSource.map((p) => (
              <span key={p._source_id} className="text-stone-500">
                <span className="font-medium text-stone-700">{p._source_name}:</span> {p.count}
              </span>
            ))}
          </div>
        )}

        {/* Kết quả */}
        {searchQuery && (
          <section>
            <h2 className="text-lg font-medium text-stone-700 mb-3">
              Kết quả &quot;{searchQuery}&quot;: {results.length} bản ghi
            </h2>
            {results.length === 0 && !loading && (
              <div className="py-12 text-center text-stone-500 rounded-xl bg-stone-100/50">
                Không có bản ghi nào chứa từ khóa này. Thử từ khác hoặc bỏ bớt từ.
              </div>
            )}
            <div className="space-y-3">
              {results.map((row, idx) => (
                <article
                  key={idx}
                  className="bg-white rounded-xl border border-stone-200 p-4 shadow-sm hover:shadow-md transition-shadow"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-xs font-medium text-emerald-700 shrink-0">
                      {row._source_name}
                    </span>
                    <button
                      type="button"
                      onClick={() => copyRow(row)}
                      className="p-1.5 rounded-lg text-stone-400 hover:bg-stone-100 hover:text-stone-600"
                      title="Sao chép"
                    >
                      <Copy className="w-4 h-4" />
                    </button>
                  </div>
                  <dl className="grid gap-1.5 text-sm mt-2">
                    {getDisplayKeys(row).map((key) => (
                      <div key={key} className="flex gap-2">
                        <dt className="text-stone-500 shrink-0 w-32">{key}:</dt>
                        <dd className="text-stone-800 break-words">
                          {highlightText(row[key], searchQuery)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </article>
              ))}
            </div>
          </section>
        )}

        {!searchQuery && query.length < 2 && (
          <p className="text-stone-400 text-sm text-center py-8">
            Gõ ít nhất 2 ký tự để tìm trong {totalRows.toLocaleString()} bản ghi
          </p>
        )}
      </main>
    </div>
  )
}
