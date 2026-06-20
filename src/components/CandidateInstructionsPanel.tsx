import React, { useState, useEffect } from 'react'
import type { ProfileStation } from '../types/ipc'

interface Props {
  moduleCode: string
  stationNumber: number
}

function getLsKey(moduleCode: string, stationNumber: number): string {
  return `instruction_mapping_${moduleCode}_${stationNumber}`
}

export default function CandidateInstructionsPanel({ moduleCode, stationNumber }: Props): React.JSX.Element | null {
  const [stations, setStations] = useState<ProfileStation[]>([])
  const [selectedStation, setSelectedStation] = useState(stationNumber)
  const [savedStation, setSavedStation] = useState<number | null>(null)
  const [instructionsOpen, setInstructionsOpen] = useState(false)

  useEffect(() => {
    async function load(): Promise<void> {
      const cfg = await window.api.getActiveProfileConfig()
      const mod = cfg?.modules.find((m) => m.code === moduleCode)
      setStations(mod?.stations ?? [])
    }
    load()
  }, [moduleCode])

  // On mount, check localStorage for a saved override
  useEffect(() => {
    const stored = localStorage.getItem(getLsKey(moduleCode, stationNumber))
    if (stored !== null) {
      const num = parseInt(stored)
      if (!isNaN(num) && stations.some((s) => s.station_number === num)) {
        setSelectedStation(num)
        setSavedStation(num)
      }
    }
  }, [moduleCode, stationNumber, stations])

  if (stations.length === 0) return null

  const activeStation = stations.find((s) => s.station_number === selectedStation)
  const instructions = activeStation?.candidate_instructions ?? null

  const isOverridden = selectedStation !== stationNumber
  const isSaved = savedStation === selectedStation

  function handleSave(): void {
    localStorage.setItem(getLsKey(moduleCode, stationNumber), String(selectedStation))
    setSavedStation(selectedStation)
  }

  return (
    <div className="border border-amber-200 rounded-xl overflow-hidden">
      <button
        onClick={() => setInstructionsOpen(!instructionsOpen)}
        className="w-full flex items-center justify-between px-4 py-3 bg-amber-50 hover:bg-amber-100 text-sm font-semibold text-amber-800"
      >
        <span>
          Candidate Instructions
          {isOverridden && (
            <span className="ml-2 text-xs font-normal text-amber-600">
              (showing Station {selectedStation} instructions)
            </span>
          )}
        </span>
        <span>{instructionsOpen ? '\u25B2 Collapse' : '\u25BC Expand'}</span>
      </button>

      {instructionsOpen && (
        <div className="bg-white">
          {/* Station selector */}
          <div className="px-4 pt-3 pb-2 border-b border-amber-100 flex items-center gap-3 flex-wrap">
            <select
              value={selectedStation}
              onChange={(e) => setSelectedStation(parseInt(e.target.value))}
              className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-amber-400"
            >
              {stations.map((s) => (
                <option key={s.station_number} value={s.station_number}>
                  Station {s.station_number} instructions{s.station_number === stationNumber ? ' (default)' : ''}
                </option>
              ))}
            </select>

            <button
              onClick={handleSave}
              disabled={isSaved}
              className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors ${
                isSaved
                  ? 'bg-green-100 text-green-700 border border-green-300 cursor-default'
                  : 'bg-amber-600 text-white hover:bg-amber-700'
              }`}
            >
              {isSaved ? 'Saved' : 'Save Selection'}
            </button>

            <span className="text-xs text-slate-400 italic">
              Choose correct station instructions and save if incorrectly matched
            </span>
          </div>

          {/* Instructions text */}
          <div className="p-4 text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">
            {instructions ?? 'No instructions available for this station.'}
          </div>
        </div>
      )}
    </div>
  )
}
