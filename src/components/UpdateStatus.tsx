import React, { useEffect, useState } from 'react'
import type { AppUpdateStatus } from '../types/ipc'

function getStatusText(status: AppUpdateStatus): { title: string; detail: string } {
  switch (status.status) {
    case 'checking':
      return { title: 'Checking for updates', detail: 'Looking for a newer version.' }
    case 'available':
      return {
        title: 'Update available',
        detail: status.availableVersion ? `Version ${status.availableVersion} is downloading.` : 'Downloading update.'
      }
    case 'downloading':
      return {
        title: 'Downloading update',
        detail: status.percent !== undefined ? `${Math.round(status.percent)}% complete.` : 'Download in progress.'
      }
    case 'downloaded':
      return {
        title: 'Update ready',
        detail: status.availableVersion ? `Version ${status.availableVersion} is ready to install.` : 'Restart to install.'
      }
    case 'not-available':
      return { title: 'Up to date', detail: 'You are using the latest version.' }
    case 'error':
      return { title: 'Update check failed', detail: status.message ?? 'Could not check for updates.' }
    default:
      return { title: 'Updates', detail: `Current version ${status.currentVersion}.` }
  }
}

export default function UpdateStatus(): React.JSX.Element | null {
  const [status, setStatus] = useState<AppUpdateStatus | null>(null)
  const [installing, setInstalling] = useState(false)

  useEffect(() => {
    let active = true

    window.api.getUpdateStatus().then((nextStatus) => {
      if (active) setStatus(nextStatus)
    })

    const unsubscribe = window.api.onUpdateStatus((nextStatus) => {
      setStatus(nextStatus)
    })

    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  if (!status || status.status === 'unsupported') return null

  const { title, detail } = getStatusText(status)
  const isBusy = status.status === 'checking' || status.status === 'available' || status.status === 'downloading'
  const showPanel =
    status.status === 'available' ||
    status.status === 'downloading' ||
    status.status === 'downloaded' ||
    (status.source === 'manual' && status.status !== 'idle')

  async function handleCheck(): Promise<void> {
    const nextStatus = await window.api.checkForUpdates()
    setStatus(nextStatus)
  }

  async function handleInstall(): Promise<void> {
    setInstalling(true)
    const result = await window.api.installUpdate()
    if (!result.success) {
      setInstalling(false)
      setStatus((prev) => prev ? { ...prev, status: 'error', message: result.error } : prev)
    }
  }

  if (!showPanel) {
    return (
      <button
        onClick={handleCheck}
        disabled={isBusy}
        className="fixed bottom-4 right-4 z-50 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        Check for updates
      </button>
    )
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 w-[min(22rem,calc(100vw-2rem))] rounded-lg border border-slate-200 bg-white p-4 shadow-lg">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-bold text-slate-800">{title}</p>
          <p className="mt-1 text-xs leading-5 text-slate-600 break-words">{detail}</p>
        </div>
        <span className="shrink-0 rounded bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-500">
          v{status.currentVersion}
        </span>
      </div>

      {status.status === 'downloading' && status.percent !== undefined && (
        <div className="mt-3 h-2 overflow-hidden rounded bg-slate-100">
          <div
            className="h-full rounded bg-blue-600 transition-all"
            style={{ width: `${Math.max(0, Math.min(status.percent, 100))}%` }}
          />
        </div>
      )}

      <div className="mt-3 flex justify-end gap-2">
        {status.status !== 'downloaded' && (
          <button
            onClick={handleCheck}
            disabled={isBusy}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Check again
          </button>
        )}
        {status.status === 'downloaded' && (
          <button
            onClick={handleInstall}
            disabled={installing}
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {installing ? 'Restarting...' : 'Restart to update'}
          </button>
        )}
      </div>
    </div>
  )
}
