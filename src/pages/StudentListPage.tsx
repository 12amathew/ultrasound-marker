import React, { useState, useEffect, useCallback } from 'react'
import { useAppStore } from '../store/appStore'

type StateFilter = 'all' | 'UNMARKED' | 'FIRST_MARK' | 'AGREED' | 'DISAGREEMENT' | 'RESOLVED'

const STATE_LABELS: Record<string, string> = {
  UNMARKED: 'Not started',
  FIRST_MARK: 'Awaiting 2nd mark',
  AGREED: 'Agreed',
  DISAGREEMENT: 'Disagreement',
  RESOLVED: 'Resolved'
}

const STATE_STYLES: Record<string, string> = {
  UNMARKED: 'bg-slate-100 text-slate-500',
  FIRST_MARK: 'bg-amber-100 text-amber-700',
  AGREED: 'bg-green-100 text-green-700',
  DISAGREEMENT: 'bg-red-100 text-red-700',
  RESOLVED: 'bg-blue-100 text-blue-700'
}

export default function StudentListPage(): React.JSX.Element {
  const { studentListContext, setScreen, openMarkingForStudent, examinerName } = useAppStore()
  const ctx = studentListContext!

  const [students, setStudents] = useState<{ student_id: string; full_name: string; state: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [filter, setFilter] = useState<StateFilter>('all')
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const data = await window.api.getStudentsWithState(ctx.module_code, ctx.station_number)
      setStudents(data)
    } catch (err) {
      setLoadError(String(err))
    } finally {
      setLoading(false)
    }
  }, [ctx.module_code, ctx.station_number])

  useEffect(() => {
    load()
  }, [load])

  const filtered = students.filter((s) => {
    if (filter !== 'all' && s.state !== filter) return false
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      if (!s.full_name.toLowerCase().includes(q) && !s.student_id.includes(q)) return false
    }
    return true
  })

  const counts = students.reduce<Record<string, number>>((acc, s) => {
    acc[s.state] = (acc[s.state] ?? 0) + 1
    return acc
  }, {})

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setScreen('dashboard')}
            className="text-slate-500 hover:text-slate-700 text-sm"
          >
            ← Dashboard
          </button>
          <span className="text-slate-300">|</span>
          <span className="font-semibold text-slate-800">
            {ctx.module_name} › Station {ctx.station_number}
          </span>
        </div>
        <span className="text-sm text-slate-500">
          Examiner: <strong className="text-slate-700">{examinerName}</strong>
        </span>
      </header>

      <main className="p-6 max-w-4xl mx-auto flex flex-col gap-4">
        {/* Summary chips */}
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setFilter('all')}
            className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors ${
              filter === 'all' ? 'bg-slate-700 text-white' : 'bg-white text-slate-600 hover:bg-slate-50 border border-slate-200'
            }`}
          >
            All ({students.length})
          </button>
          {Object.entries(STATE_LABELS).map(([state, label]) => {
            const count = counts[state] ?? 0
            if (count === 0) return null
            return (
              <button
                key={state}
                onClick={() => setFilter(filter === state ? 'all' : state as StateFilter)}
                className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors border ${
                  filter === state
                    ? 'bg-slate-700 text-white border-transparent'
                    : 'bg-white text-slate-600 hover:bg-slate-50 border-slate-200'
                }`}
              >
                {label} ({count})
              </button>
            )
          })}
          <div className="flex-1" />
          <button
            onClick={load}
            disabled={loading}
            className="px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-40"
          >
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>

        {/* Search */}
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or student ID…"
          className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />

        {/* Student list */}
        <div className="bg-white rounded-2xl shadow overflow-hidden">
          {loading ? (
            <div className="text-center text-slate-400 py-16">Loading students…</div>
          ) : filtered.length === 0 ? (
            <div className="text-center text-slate-400 py-16">No students match the current filter.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide border-b border-slate-100">
                <tr>
                  <th className="px-5 py-3 text-left font-semibold">Name</th>
                  <th className="px-5 py-3 text-left font-semibold">Student ID</th>
                  <th className="px-5 py-3 text-left font-semibold">Status</th>
                  <th className="px-5 py-3 text-right font-semibold" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filtered.map((s) => (
                  <tr key={s.student_id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-3 font-medium text-slate-800">{s.full_name}</td>
                    <td className="px-5 py-3 font-mono text-slate-500 text-xs">{s.student_id}</td>
                    <td className="px-5 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${STATE_STYLES[s.state] ?? 'bg-slate-100 text-slate-500'}`}>
                        {STATE_LABELS[s.state] ?? s.state}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <button
                        onClick={() => openMarkingForStudent({ student_id: s.student_id, full_name: s.full_name })}
                        className="px-3 py-1.5 bg-blue-600 text-white text-xs font-semibold rounded-lg hover:bg-blue-700"
                      >
                        Mark
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <p className="text-xs text-slate-400 text-center">
          {filtered.length} of {students.length} students shown
        </p>
      </main>
    </div>
  )
}
