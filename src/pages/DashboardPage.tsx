import React, { useEffect, useState, useCallback } from 'react'
import { useAppStore, EXAMINER_MODULES, type ExaminerName } from '../store/appStore'
import type { ModuleProgress, StationProgress } from '../types/ipc'
import stationsConfig from '../../config/stations.json'

const REFRESH_INTERVAL_MS = 30_000

export default function DashboardPage(): React.JSX.Element {
  const { examinerName, setDashboardProgress, dashboardProgress, openStudentList, openResolutionPage, setScreen } =
    useAppStore()

  const [expandedModules, setExpandedModules] = useState<Set<string>>(new Set())
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date())

  const refresh = useCallback(async () => {
    const progress = await window.api.getDashboardProgress(examinerName ?? '')
    setDashboardProgress(progress)
    setLastRefresh(new Date())
  }, [setDashboardProgress, examinerName])

  useEffect(() => {
    setDashboardProgress([])
    refresh()
    const interval = setInterval(refresh, REFRESH_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [refresh, setDashboardProgress])

  function toggleModule(code: string): void {
    setExpandedModules((prev) => {
      const next = new Set(prev)
      if (next.has(code)) next.delete(code)
      else next.add(code)
      return next
    })
  }

  function getStationConfig(moduleCode: string, stationNumber: number) {
    const mod = stationsConfig.modules.find((m) => m.code === moduleCode)
    return mod?.stations.find((s) => s.number === stationNumber) ?? null
  }

  return (
    <div className="min-h-screen bg-slate-100">
      {/* Top bar */}
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-800">Ultrasound Marking — Dashboard</h1>
        <div className="flex items-center gap-4">
          <span className="text-sm text-slate-500">
            Examiner: <strong className="text-slate-700">{examinerName}</strong>
          </span>
          <span className="text-xs text-slate-400">
            Refreshed {lastRefresh.toLocaleTimeString()}
          </span>
          <button
            onClick={refresh}
            className="text-sm text-blue-600 hover:underline"
          >
            Refresh now
          </button>
          <button
            onClick={async () => {
              await window.api.exportResults()
            }}
            className="px-4 py-2 bg-green-600 text-white text-sm font-semibold rounded-lg hover:bg-green-700"
          >
            Export Results
          </button>
          <button
            onClick={() => setScreen('admin')}
            className="px-4 py-2 bg-violet-600 text-white text-sm font-semibold rounded-lg hover:bg-violet-700"
          >
            Admin
          </button>
          <button
            onClick={() => setScreen('login')}
            className="px-4 py-2 bg-slate-200 text-slate-700 text-sm font-semibold rounded-lg hover:bg-slate-300"
          >
            Change Examiner
          </button>
        </div>
      </header>

      <main className="p-6 max-w-5xl mx-auto flex flex-col gap-4">
        {dashboardProgress.length === 0 && (
          <div className="text-center text-slate-500 mt-16">
            <p>Loading progress…</p>
          </div>
        )}

        {dashboardProgress
          .filter((mod) => {
            if (!examinerName) return true
            const assigned = EXAMINER_MODULES[examinerName as ExaminerName]
            return assigned === null || assigned.includes(mod.module_code)
          })
          .map((mod) => {
          const isExpanded = expandedModules.has(mod.module_code)
          const totalMarkedByMe = mod.stations.reduce((s, st) => s + (st.marked_by_me ?? 0), 0)
          const totalPossible = mod.total_students * mod.stations.length
          const totalNeeds = mod.stations.reduce((s, st) => s + st.needs_resolution, 0)

          return (
            <div key={mod.module_code} className="bg-white rounded-2xl shadow overflow-hidden">
              {/* Module header */}
              <button
                onClick={() => toggleModule(mod.module_code)}
                className="w-full flex items-center justify-between px-6 py-4 hover:bg-slate-50 transition-colors"
              >
                <div className="flex items-center gap-4">
                  <CircularProgress value={totalMarkedByMe} max={totalPossible} size={48} />
                  <div className="text-left">
                    <p className="font-bold text-slate-800">
                      {mod.module_name}{' '}
                      <span className="text-slate-400 font-normal text-sm">({mod.module_code})</span>
                    </p>
                    <p className="text-sm text-slate-500">
                      {mod.total_students === 0
                        ? <span className="text-amber-600 font-semibold">No students imported</span>
                        : <>{totalMarkedByMe} of {totalPossible} marked by you</>
                      }
                      {totalNeeds > 0 && (
                        <span className="ml-2 text-amber-600 font-semibold">· {totalNeeds} need resolution</span>
                      )}
                    </p>
                  </div>
                </div>
                <span className="text-slate-400">{isExpanded ? '▲' : '▼'}</span>
              </button>

              {/* Station rows */}
              {isExpanded && (
                <div className="border-t border-slate-100">
                  {mod.stations.map((st) => {
                    const stConfig = getStationConfig(mod.module_code, st.station_number)
                    return (
                      <StationRow
                        key={st.station_number}
                        station={st}
                        moduleCode={mod.module_code}
                        moduleName={mod.module_name}
                        hasConclusion={stConfig?.has_conclusion ?? false}
                        conclusionReferenceText={stConfig?.conclusion_reference_text ?? null}
                        examinerName={examinerName!}
                        onMark={() =>
                          openStudentList({
                            module_code: mod.module_code,
                            module_name: mod.module_name,
                            station_number: st.station_number,
                            has_conclusion: stConfig?.has_conclusion ?? false,
                            conclusion_reference_text: stConfig?.conclusion_reference_text ?? null,
                            candidate_instructions: stConfig?.candidate_instructions ?? null
                          })
                        }
                        onResolve={() =>
                          openResolutionPage({
                            module_code: mod.module_code,
                            module_name: mod.module_name,
                            station_number: st.station_number,
                            has_conclusion: stConfig?.has_conclusion ?? false,
                            conclusion_reference_text: stConfig?.conclusion_reference_text ?? null,
                            candidate_instructions: stConfig?.candidate_instructions ?? null
                          })
                        }
                      />
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </main>
    </div>
  )
}

function StationRow({
  station,
  moduleCode,
  moduleName,
  hasConclusion,
  conclusionReferenceText,
  examinerName,
  onMark,
  onResolve
}: {
  station: StationProgress
  moduleCode: string
  moduleName: string
  hasConclusion: boolean
  conclusionReferenceText: string | null
  examinerName: string
  onMark: () => void
  onResolve: () => void
}): React.JSX.Element {
  const isPlaceholder =
    conclusionReferenceText?.startsWith('PLACEHOLDER') ?? false

  return (
    <div className="flex items-center justify-between px-6 py-3 border-b border-slate-50 last:border-0 hover:bg-slate-50">
      <div className="flex items-center gap-4">
        <CircularProgress value={station.marked_by_me ?? 0} max={station.total} size={36} />
        <div>
          <p className="font-medium text-slate-700 text-sm">{station.label}</p>
          <p className="text-xs text-slate-400">
            {station.marked_by_me ?? 0}/{station.total} marked by you
            {station.awaiting_second > 0 && ` · ${station.awaiting_second} awaiting 2nd mark`}
          </p>
          {hasConclusion && isPlaceholder && (
            <p className="text-xs text-red-500 font-semibold">
              ⚠ Conclusion reference text not configured
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        {station.needs_resolution > 0 && (
          <span className="px-2 py-1 bg-amber-100 text-amber-700 text-xs font-bold rounded-full">
            {station.needs_resolution} to resolve
          </span>
        )}
        {station.needs_resolution > 0 && (
          <button
            onClick={onResolve}
            className="px-3 py-1.5 bg-amber-500 text-white text-xs font-semibold rounded-lg hover:bg-amber-600"
          >
            Resolve
          </button>
        )}
        <button
          onClick={onMark}
          className="px-3 py-1.5 bg-blue-600 text-white text-xs font-semibold rounded-lg hover:bg-blue-700"
        >
          Mark
        </button>
      </div>
    </div>
  )
}

function CircularProgress({
  value,
  max,
  size
}: {
  value: number
  max: number
  size: number
}): React.JSX.Element {
  const pct = max === 0 ? 0 : Math.min(value / max, 1)
  const r = (size - 6) / 2
  const circ = 2 * Math.PI * r
  const dash = pct * circ

  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e2e8f0" strokeWidth={5} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={pct === 1 ? '#16a34a' : '#2563eb'}
          strokeWidth={5}
          strokeDasharray={`${dash} ${circ - dash}`}
          strokeLinecap="round"
        />
      </svg>
      <span
        className="absolute inset-0 flex items-center justify-center text-xs font-bold text-slate-700"
        style={{ fontSize: size < 40 ? 9 : 11 }}
      >
        {max === 0 ? '—' : `${value}/${max}`}
      </span>
    </div>
  )
}
