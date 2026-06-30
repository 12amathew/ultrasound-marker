import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join, dirname } from 'path'
import { existsSync, copyFileSync, mkdirSync } from 'fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import Database from 'better-sqlite3'
import { initSchema } from '../src/db/schema'
import {
  getConfig,
  setConfig,
  getStationProgress,
  getNextStudentToMark,
  acquireLock,
  releaseLock,
  saveExaminerMark,
  saveConsensus,
  getMarkingState,
  getExaminerMarksForStation,
  getDisagreements,
  getStudentsByModule,
  deleteAssessmentProfile
} from '../src/db/queries'
import { importCsv } from '../src/ipc/csvImport'
import { runFileSort } from '../src/ipc/fileSorter'
import { getStudentImages, getReferenceImages, readFileAsBase64 } from '../src/ipc/imageHandler'
import { exportResults } from '../src/ipc/export'
import {
  getDicomLinksForStation,
  getDicomServerConfig,
  getDicomStudyPreview,
  getDicomStudyPreviews,
  getDicomUnresolvedStudyDetails,
  getRecentDicomUnresolved,
  linkUnresolvedDicomStudyToStation,
  prepareDicomExportFolder,
  refreshDicomLinkPreviewState,
  saveDicomServerConfig,
  syncDicomStudies,
  testOrthancConnection,
  unlinkDicomStudyLink,
  uploadPreparedDicomExportFolder,
  uploadDicomFolderToOrthanc
} from '../src/ipc/dicom'
import stationsConfig from '../config/stations.json'
import type { DicomServerConfig, ModuleProgress } from '../src/types/ipc'

// ── Database singleton ───────────────────────────────────────────────────────

let db: Database.Database | null = null

function getDb(): Database.Database {
  if (!db) throw new Error('Database not initialised. Run setup first.')
  return db
}

function initDb(dbPath: string): void {
  const dir = dirname(dbPath)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  // Backup before opening if already exists
  if (existsSync(dbPath)) {
    const ts = new Date().toISOString().replace(/[:.]/g, '-')
    const backupPath = dbPath.replace('.db', `_backup_${ts}.db`)
    copyFileSync(dbPath, backupPath)
  }

  db = new Database(dbPath)
  initSchema(db)
}

// ── Window ───────────────────────────────────────────────────────────────────

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    title: 'Ultrasound Marker',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow.show())

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// ── App lifecycle ────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.ultrasoundmarker')
  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))
  registerIpcHandlers()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// ── IPC Handlers ─────────────────────────────────────────────────────────────

function registerIpcHandlers(): void {

  // ── Setup / Config ─────────────────────────────────────────────────────────

  ipcMain.handle('config:get', (_e, key: string) => {
    if (!db) return null
    return getConfig(db, key)
  })

  ipcMain.handle('config:set', (_e, key: string, value: string) => {
    setConfig(getDb(), key, value)
  })

  ipcMain.handle('setup:selectFolder', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('setup:selectFile', async (_e, filters?: Electron.FileFilter[]) => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: filters ?? []
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('setup:initDb', (_e, dbPath: string) => {
    initDb(dbPath)
    setConfig(getDb(), 'db_path', dbPath)
  })

  ipcMain.handle('setup:loadExistingDb', (_e, dbPath: string) => {
    if (!existsSync(dbPath)) return false
    db = new Database(dbPath)
    initSchema(db)
    return true
  })

  // ── CSV Import ─────────────────────────────────────────────────────────────

  ipcMain.handle('csv:import', (_e, filePath: string) => {
    return importCsv(getDb(), filePath)
  })

  // ── File Sorter ────────────────────────────────────────────────────────────

  ipcMain.handle('filesorter:run', (_e, sourcePath: string, targetRoot: string) => {
    return runFileSort(getDb(), sourcePath, targetRoot)
  })

  // ── Students ───────────────────────────────────────────────────────────────

  ipcMain.handle('students:byModule', (_e, module_code: string) => {
    return getStudentsByModule(getDb(), module_code)
  })

  // ── Dashboard ──────────────────────────────────────────────────────────────

  ipcMain.handle('dashboard:progress', () => {
    const database = getDb()
    const progress: ModuleProgress[] = stationsConfig.modules.map((mod) => {
      const students = getStudentsByModule(database, mod.code)
      const stations = mod.stations.map((st) => {
        const p = getStationProgress(database, mod.code, st.number)
        return {
          station_number: st.number,
          label: st.label,
          resolved: p.resolved,
          total: p.total,
          awaiting_second: p.awaiting_second,
          needs_resolution: p.needs_resolution
        }
      })
      return {
        module_code: mod.code,
        module_name: mod.name,
        total_students: students.length,
        stations
      }
    })
    return progress
  })

  // ── Marking ────────────────────────────────────────────────────────────────

  ipcMain.handle(
    'marking:nextStudent',
    (_e, module_code: string, station_number: number, examiner_name: string, skipList: string[]) => {
      return getNextStudentToMark(getDb(), module_code, station_number, examiner_name, skipList)
    }
  )

  ipcMain.handle(
    'marking:acquireLock',
    (_e, student_id: string, module_code: string, station_number: number, examiner_name: string) => {
      return acquireLock(getDb(), student_id, module_code, station_number, examiner_name)
    }
  )

  ipcMain.handle(
    'marking:releaseLock',
    (_e, student_id: string, module_code: string, station_number: number) => {
      releaseLock(getDb(), student_id, module_code, station_number)
    }
  )

  ipcMain.handle(
    'marking:saveMark',
    (
      _e,
      student_id: string,
      module_code: string,
      station_number: number,
      examiner_name: string,
      img1_mark: number,
      img2_mark: number,
      conclusion_mark: number | null,
      has_conclusion: boolean
    ) => {
      saveExaminerMark(
        getDb(), student_id, module_code, station_number,
        examiner_name, img1_mark, img2_mark, conclusion_mark, has_conclusion
      )
    }
  )

  ipcMain.handle(
    'marking:getState',
    (_e, student_id: string, module_code: string, station_number: number) => {
      return getMarkingState(getDb(), student_id, module_code, station_number)
    }
  )

  // ── Resolution ─────────────────────────────────────────────────────────────

  ipcMain.handle('resolution:getDisagreements', (_e, module_code: string, station_number: number) => {
    return getDisagreements(getDb(), module_code, station_number)
  })

  ipcMain.handle(
    'resolution:getMarks',
    (_e, student_id: string, module_code: string, station_number: number) => {
      return getExaminerMarksForStation(getDb(), student_id, module_code, station_number)
    }
  )

  ipcMain.handle(
    'resolution:saveConsensus',
    (
      _e,
      student_id: string,
      module_code: string,
      station_number: number,
      examiner_name: string,
      img1_mark: number,
      img2_mark: number,
      conclusion_mark: number | null,
      has_conclusion: boolean
    ) => {
      saveConsensus(
        getDb(), student_id, module_code, station_number,
        examiner_name, img1_mark, img2_mark, conclusion_mark, has_conclusion
      )
    }
  )

  // ── Images ─────────────────────────────────────────────────────────────────

  ipcMain.handle(
    'images:getStudentImages',
    (_e, student_id: string, module_code: string, station_number: number) => {
      const targetRoot = db ? getConfig(db, 'target_root') : null
      if (!targetRoot) return { img1Path: null, img2Path: null, conclusionPath: null }
      return getStudentImages(targetRoot, student_id, module_code, station_number)
    }
  )

  ipcMain.handle('images:getReferenceImages', (_e, module_code: string, station_number: number) => {
    const refRoot = db ? getConfig(db, 'reference_images_root') : null
    if (!refRoot) return { img1Path: null, img2Path: null }
    return getReferenceImages(refRoot, module_code, station_number)
  })

  ipcMain.handle('images:readFile', (_e, filePath: string) => {
    return readFileAsBase64(filePath)
  })

  // ── Export ─────────────────────────────────────────────────────────────────

  ipcMain.handle('export:results', async () => {
    const result = await dialog.showSaveDialog({
      defaultPath: `Results_${new Date().toISOString().slice(0, 10)}_${new Date().toTimeString().slice(0, 5).replace(':', '')}.xlsx`,
      filters: [{ name: 'Excel', extensions: ['xlsx'] }]
    })
    if (result.canceled || !result.filePath) return
    await exportResults(getDb(), result.filePath)
  })

  // ── Assessment profiles ───────────────────────────────────────────────────

  ipcMain.handle('profiles:delete', (_e, profileId: string) => {
    return deleteAssessmentProfile(getDb(), profileId)
  })

  // ── DICOM / Orthanc ────────────────────────────────────────────────────────

  ipcMain.handle('dicom:getConfig', () => {
    if (!db) return null
    return getDicomServerConfig(db)
  })

  ipcMain.handle('dicom:saveConfig', (_e, cfg: DicomServerConfig) => {
    return saveDicomServerConfig(getDb(), cfg)
  })

  ipcMain.handle('dicom:testConnection', async (_e, cfg: DicomServerConfig) => {
    return testOrthancConnection(cfg)
  })

  ipcMain.handle('dicom:sync', async (_e, cfg: DicomServerConfig) => {
    return syncDicomStudies(getDb(), cfg)
  })

  ipcMain.handle('dicom:uploadFolder', async (_e, cfg: DicomServerConfig, folderPath: string) => {
    saveDicomServerConfig(getDb(), cfg)
    return uploadDicomFolderToOrthanc(cfg, folderPath)
  })

  ipcMain.handle('dicom:prepareUploadExportFolder', (_e, folderPath: string) => {
    return prepareDicomExportFolder(getDb(), folderPath)
  })

  ipcMain.handle(
    'dicom:uploadPreparedExportFolder',
    async (_e, cfg: DicomServerConfig, folderPath: string, validGroupKeys: string[]) => {
      saveDicomServerConfig(getDb(), cfg)
      return uploadPreparedDicomExportFolder(getDb(), cfg, folderPath, validGroupKeys)
    }
  )

  ipcMain.handle(
    'dicom:getLinksForStation',
    (_e, student_id: string, module_code: string, station_number: number) => {
      return getDicomLinksForStation(getDb(), student_id, module_code, station_number)
    }
  )

  ipcMain.handle('dicom:getStudyPreview', (_e, orthanc_study_id: string) => {
    return getDicomStudyPreview(getDb(), orthanc_study_id)
  })

  ipcMain.handle('dicom:getStudyPreviews', (_e, orthanc_study_id: string, limit?: number) => {
    return getDicomStudyPreviews(getDb(), orthanc_study_id, limit ?? 2)
  })

  ipcMain.handle('dicom:getUnresolved', (_e, limit?: number) => {
    return getRecentDicomUnresolved(getDb(), limit ?? 100)
  })

  ipcMain.handle('dicom:getUnresolvedDetails', (_e, unresolved_id: number) => {
    return getDicomUnresolvedStudyDetails(getDb(), unresolved_id)
  })

  ipcMain.handle(
    'dicom:linkUnresolvedToStation',
    (
      _e,
      unresolved_id: number,
      student_id: string,
      module_code: string,
      station_number: number
    ) => {
      return linkUnresolvedDicomStudyToStation(
        getDb(),
        unresolved_id,
        student_id,
        module_code,
        station_number
      )
    }
  )

  ipcMain.handle('dicom:unlinkStudyLink', (_e, link_id: number, restore_unresolved: boolean) => {
    return unlinkDicomStudyLink(getDb(), link_id, restore_unresolved)
  })

  ipcMain.handle('dicom:refreshLinkPreviewState', (_e, link_id: number) => {
    return refreshDicomLinkPreviewState(getDb(), link_id)
  })

  // ── File Sort Log ──────────────────────────────────────────────────────────

  ipcMain.handle('log:getFileSortLog', () => {
    return getDb()
      .prepare('SELECT * FROM file_sort_log ORDER BY run_at DESC LIMIT 500')
      .all()
  })
}
