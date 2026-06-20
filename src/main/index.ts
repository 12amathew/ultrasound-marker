import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join, basename } from 'path'
import { existsSync, copyFileSync, mkdirSync, writeFileSync, readFileSync, unlinkSync, readdirSync } from 'fs'
import { autoUpdater, type ProgressInfo, type UpdateInfo } from 'electron-updater'
import Database from 'better-sqlite3'
import { initSchema } from '../db/schema'
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
  getStudentsWithState,
  getActiveProfileConfig,
  getProfileModules,
  listAssessmentProfiles,
  createAssessmentProfile,
  setActiveAssessmentProfile,
  getStationDefinition,
  saveExaminerFormResponses,
  getExaminerFormMarksForStation,
  saveDynamicConsensus,
  resolveModuleAlias
} from '../db/queries'
import { importCsv } from '../ipc/csvImport'
import { runFileSort, runFindConclusions } from '../ipc/fileSorter'
import { runImageAudit } from '../ipc/imageAudit'
import { exportMarks, importMarks } from '../ipc/marksSync'
import { getStudentImages, getReferenceImages, readFileAsBase64 } from '../ipc/imageHandler'
import { exportResults } from '../ipc/export'
import {
  exportProfilePackage,
  importProfilePackage,
  saveProfileConfig,
  setAdminPin,
  verifyAdminPin
} from '../ipc/profilePackages'
import {
  getDicomLinksForStation,
  getDicomServerConfig,
  getDicomStudyPreview,
  getDicomStudyPreviews,
  getRecentDicomUnresolved,
  saveDicomServerConfig,
  syncDicomStudies,
  testOrthancConnection,
  uploadDicomFolderToOrthanc
} from '../ipc/dicom'
import type { AppUpdateStatus, DicomServerConfig, ModuleProgress } from '../types/ipc'

// Ensure consistent userData path between dev and prod (both use productName)
app.setName('Ultrasound Marker')

// ── App updates ─────────────────────────────────────────────────────────────

let updaterConfigured = false
let updateCheckPromise: Promise<AppUpdateStatus> | null = null
let updateCheckSource: AppUpdateStatus['source'] = 'automatic'
let updateStatus: AppUpdateStatus = {
  status: 'idle',
  source: 'automatic',
  currentVersion: app.getVersion()
}

function updateStatusPatch(status: AppUpdateStatus['status'], patch: Partial<AppUpdateStatus> = {}): AppUpdateStatus {
  updateStatus = {
    ...updateStatus,
    ...patch,
    status,
    currentVersion: app.getVersion()
  }
  BrowserWindow.getAllWindows().forEach((window) => {
    window.webContents.send('updates:status', updateStatus)
  })
  return updateStatus
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function setupAutoUpdater(): void {
  if (updaterConfigured) return
  updaterConfigured = true

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => {
    updateStatusPatch('checking', { source: updateCheckSource, message: 'Checking for updates...' })
  })

  autoUpdater.on('update-available', (info: UpdateInfo) => {
    updateStatusPatch('available', {
      source: updateCheckSource,
      availableVersion: info.version,
      percent: undefined,
      message: `Version ${info.version} is available.`
    })
  })

  autoUpdater.on('download-progress', (progress: ProgressInfo) => {
    updateStatusPatch('downloading', {
      source: updateCheckSource,
      percent: progress.percent,
      message: `Downloading update ${Math.round(progress.percent)}%`
    })
  })

  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    updateStatusPatch('downloaded', {
      source: updateCheckSource,
      availableVersion: info.version,
      percent: 100,
      checkedAt: new Date().toISOString(),
      message: `Version ${info.version} is ready to install.`
    })
  })

  autoUpdater.on('update-not-available', () => {
    updateStatusPatch('not-available', {
      source: updateCheckSource,
      availableVersion: undefined,
      percent: undefined,
      checkedAt: new Date().toISOString(),
      message: 'You are on the latest version.'
    })
  })

  autoUpdater.on('error', (error: Error) => {
    updateStatusPatch('error', {
      source: updateCheckSource,
      percent: undefined,
      checkedAt: new Date().toISOString(),
      message: getErrorMessage(error)
    })
  })
}

async function checkForAppUpdates(source: AppUpdateStatus['source'] = 'automatic'): Promise<AppUpdateStatus> {
  if (!app.isPackaged) {
    return updateStatusPatch('unsupported', {
      source,
      message: 'Updates are available in packaged builds only.'
    })
  }

  setupAutoUpdater()
  updateCheckSource = source

  if (updateStatus.status === 'downloaded') {
    return updateStatus
  }

  if (updateCheckPromise) {
    return updateCheckPromise
  }

  updateCheckPromise = autoUpdater
    .checkForUpdates()
    .then(() => updateStatus)
    .catch((error: unknown) =>
      updateStatusPatch('error', {
        source,
        percent: undefined,
        checkedAt: new Date().toISOString(),
        message: getErrorMessage(error)
      })
    )
    .finally(() => {
      updateCheckPromise = null
    })

  return updateCheckPromise
}

function installAppUpdate(): { success: boolean; error?: string } {
  if (updateStatus.status !== 'downloaded') {
    return { success: false, error: 'No downloaded update is ready to install.' }
  }

  setImmediate(() => {
    autoUpdater.quitAndInstall()
  })
  return { success: true }
}

// ── Database singleton ───────────────────────────────────────────────────────

let db: Database.Database | null = null

function getDb(): Database.Database {
  if (!db) throw new Error('Database not initialised. Run setup first.')
  return db
}

// ── Persisted config (config.json in userData) ───────────────────────────────

interface PersistedConfig {
  target_root: string
  reference_images_root: string
  source_path?: string
}

function getConfigFilePath(): string {
  return join(app.getPath('userData'), 'config.json')
}

function readPersistedConfig(): PersistedConfig | null {
  const p = getConfigFilePath()
  if (!existsSync(p)) return null
  try {
    return JSON.parse(readFileSync(p, 'utf-8')) as PersistedConfig
  } catch {
    return null
  }
}

function writePersistedConfig(cfg: PersistedConfig): void {
  const dir = app.getPath('userData')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(getConfigFilePath(), JSON.stringify(cfg, null, 2), 'utf-8')
}

// ── Database init ─────────────────────────────────────────────────────────────

function initDb(): void {
  const userDataDir = app.getPath('userData')
  if (!existsSync(userDataDir)) mkdirSync(userDataDir, { recursive: true })

  const newDbPath = join(userDataDir, 'marks.db')

  // One-time migration: if new DB doesn't exist yet, check old Dropbox location
  if (!existsSync(newDbPath)) {
    const cfg = readPersistedConfig()
    if (cfg?.target_root) {
      const oldDbPath = join(cfg.target_root, 'marks.db')
      if (existsSync(oldDbPath)) {
        try {
          const oldDb = new Database(oldDbPath, { readonly: true })
          const count = (oldDb.prepare('SELECT COUNT(*) as c FROM examiner_marks').get() as { c: number }).c
          oldDb.close()
          if (count > 0) copyFileSync(oldDbPath, newDbPath)
        } catch {
          // Old DB corrupt or incompatible — start fresh
        }
      }
    }
  }

  db = new Database(newDbPath)
  initSchema(db)

  // Clean up old DB, WAL/SHM files, and backup files from Dropbox folder (non-fatal)
  const cfg = readPersistedConfig()
  if (cfg?.target_root) {
    try {
      for (const suffix of ['marks.db', 'marks.db-wal', 'marks.db-shm']) {
        const p = join(cfg.target_root, suffix)
        try { if (existsSync(p)) unlinkSync(p) } catch { /* may be locked */ }
      }
      for (const f of readdirSync(cfg.target_root)) {
        if (f.startsWith('marks_backup_') && (f.endsWith('.db') || f.endsWith('.db-wal') || f.endsWith('.db-shm'))) {
          try { unlinkSync(join(cfg.target_root, f)) } catch { /* may be locked */ }
        }
      }
    } catch { /* non-fatal */ }
  }
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

  // Load dev server URL in development, or local file in production
  const isDev = !app.isPackaged
  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// ── App lifecycle ────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.ultrasoundmarker')
  }
  registerIpcHandlers()
  setupAutoUpdater()
  createWindow()
  if (app.isPackaged) {
    setTimeout(() => {
      void checkForAppUpdates()
    }, 3000)
  } else {
    updateStatusPatch('unsupported', {
      source: 'automatic',
      message: 'Updates are available in packaged builds only.'
    })
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// ── IPC Handlers ─────────────────────────────────────────────────────────────

function registerIpcHandlers(): void {

  // ── App updates ───────────────────────────────────────────────────────────

  ipcMain.handle('updates:getStatus', () => {
    return updateStatus
  })

  ipcMain.handle('updates:check', () => {
    return checkForAppUpdates('manual')
  })

  ipcMain.handle('updates:install', () => {
    return installAppUpdate()
  })

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

  // Auto-load on startup: reads config.json, opens DB, returns config to renderer
  ipcMain.handle('setup:autoLoad', () => {
    const cfg = readPersistedConfig()
    if (!cfg) {
      try {
        initDb()
        return { configured: false }
      } catch (err) {
        return { configured: false, error: String(err) }
      }
    }
    try {
      initDb()
      return { configured: true, config: cfg }
    } catch (err) {
      return { configured: false, error: String(err) }
    }
  })

  // Returns persisted config for pre-populating the Edit Setup form
  ipcMain.handle('setup:getConfig', () => {
    return readPersistedConfig()
  })

  // Called by SetupPage on first run or when editing config
  ipcMain.handle('setup:saveConfig', (_e, cfg: PersistedConfig) => {
    try {
      writePersistedConfig(cfg)
      if (!db) initDb()
      getDb().prepare(`
        INSERT INTO setup_config (id, target_root, reference_images_root, source_path, configured_at)
        VALUES (1, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          target_root=excluded.target_root,
          reference_images_root=excluded.reference_images_root,
          source_path=excluded.source_path,
          configured_at=excluded.configured_at
      `).run(cfg.target_root, cfg.reference_images_root, cfg.source_path ?? null, new Date().toISOString())
      setConfig(getDb(), 'target_root', cfg.target_root)
      setConfig(getDb(), 'reference_images_root', cfg.reference_images_root)
      if (cfg.source_path) setConfig(getDb(), 'source_path', cfg.source_path)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  // ── Assessment Profiles ──────────────────────────────────────────────────

  ipcMain.handle('profiles:getActiveConfig', () => {
    if (!db) return null
    return getActiveProfileConfig(getDb())
  })

  ipcMain.handle('profiles:list', () => {
    return listAssessmentProfiles(getDb())
  })

  ipcMain.handle('profiles:create', (_e, name: string) => {
    return createAssessmentProfile(getDb(), name)
  })

  ipcMain.handle('profiles:setActive', (_e, profileId: string) => {
    setActiveAssessmentProfile(getDb(), profileId)
  })

  ipcMain.handle('profiles:getStation', (_e, moduleCode: string, stationNumber: number) => {
    return getStationDefinition(getDb(), moduleCode, stationNumber)
  })

  ipcMain.handle('profiles:saveConfig', (_e, cfg) => {
    return saveProfileConfig(getDb(), cfg)
  })

  ipcMain.handle('profiles:setAdminPin', (_e, profileId: string, pin: string) => {
    setAdminPin(getDb(), profileId, pin)
  })

  ipcMain.handle('profiles:verifyAdminPin', (_e, profileId: string, pin: string) => {
    return verifyAdminPin(getDb(), profileId, pin)
  })

  ipcMain.handle('profiles:exportPackage', async () => {
    const result = await dialog.showSaveDialog({
      defaultPath: `assessment-settings-${new Date().toISOString().slice(0, 10)}.umprofile`,
      filters: [{ name: 'Assessment Profile', extensions: ['umprofile'] }]
    })
    if (result.canceled || !result.filePath) return { success: false }
    await exportProfilePackage(getDb(), result.filePath)
    return { success: true, path: result.filePath }
  })

  ipcMain.handle('profiles:importPackage', async (_e, forceReplace: boolean) => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Assessment Profile', extensions: ['umprofile'] }]
    })
    if (result.canceled || !result.filePaths[0]) return { success: false }
    return importProfilePackage(getDb(), result.filePaths[0], app.getPath('userData'), forceReplace)
  })

  // ── CSV Import ─────────────────────────────────────────────────────────────

  ipcMain.handle('csv:import', (_e, filePath: string) => {
    return importCsv(getDb(), filePath)
  })

  // ── File Sorter ────────────────────────────────────────────────────────────

  ipcMain.handle('filesorter:run', (_e, sourcePath: string, targetRoot: string) => {
    return runFileSort(getDb(), sourcePath, targetRoot)
  })

  ipcMain.handle('filesorter:findConclusions', (_e, assessmentRoot: string, targetRoot: string) => {
    const conclusionStations: Record<string, number[]> = {}
    for (const mod of getProfileModules(getDb())) {
      const stations = mod.stations
        .filter((s) => s.form_fields.some((field) => field.field_id.toUpperCase().includes('CONCLUSION')))
        .map((s) => s.station_number)
      if (stations.length > 0) conclusionStations[mod.code] = stations
    }
    return runFindConclusions(getDb(), assessmentRoot, targetRoot, conclusionStations)
  })

  // ── Students ───────────────────────────────────────────────────────────────

  ipcMain.handle('students:byModule', (_e, module_code: string) => {
    return getStudentsByModule(getDb(), module_code)
  })

  ipcMain.handle('students:withState', (_e, module_code: string, station_number: number) => {
    return getStudentsWithState(getDb(), module_code, station_number)
  })

  // ── Dashboard ──────────────────────────────────────────────────────────────

  ipcMain.handle('dashboard:progress', (_e, examiner_name: string) => {
    const database = getDb()
    const progress: ModuleProgress[] = getProfileModules(database).map((mod) => {
      const students = getStudentsByModule(database, mod.code)
      const stations = mod.stations.map((st) => {
        const p = getStationProgress(database, mod.code, st.station_number, examiner_name)
        return {
          station_number: st.station_number,
          label: st.label,
          candidate_instructions: st.candidate_instructions,
          form_fields: st.form_fields,
          marked_by_me: p.marked_by_me,
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
      img1_mark: number | null,
      img2_mark: number | null,
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
    'marking:saveFormMark',
    (_e, student_id: string, module_code: string, station_number: number, examiner_name: string, responses) => {
      saveExaminerFormResponses(getDb(), student_id, module_code, station_number, examiner_name, responses)
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
      return getExaminerFormMarksForStation(getDb(), student_id, module_code, station_number)
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

  ipcMain.handle(
    'resolution:saveDynamicConsensus',
    (_e, student_id: string, module_code: string, station_number: number, examiner_name: string, responses) => {
      saveDynamicConsensus(getDb(), student_id, module_code, station_number, examiner_name, responses)
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
    try {
      await exportResults(getDb(), result.filePath)
    } catch (err) {
      dialog.showErrorBox('Export Failed', String(err))
      throw err
    }
  })

  // ── Reset marks ───────────────────────────────────────────────────────────

  ipcMain.handle('marks:reset', () => {
    const db = getDb()
    db.prepare('DELETE FROM examiner_marks').run()
    db.prepare('DELETE FROM resolved_marks').run()
    db.prepare('DELETE FROM marking_state').run()
    db.prepare('DELETE FROM marking_locks').run()
    db.prepare('DELETE FROM examiner_form_responses').run()
    db.prepare('DELETE FROM resolved_form_responses').run()
    db.prepare('DELETE FROM profile_marking_state').run()
    db.prepare('DELETE FROM profile_marking_locks').run()
  })

  // ── File Sort Log ──────────────────────────────────────────────────────────

  ipcMain.handle('log:getFileSortLog', () => {
    return getDb()
      .prepare('SELECT * FROM file_sort_log ORDER BY run_at DESC LIMIT 500')
      .all()
  })

  // ── Marks Sync ────────────────────────────────────────────────────────────

  ipcMain.handle('marks:export', async () => {
    const result = await dialog.showSaveDialog({
      defaultPath: `marks_export_${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (result.canceled || !result.filePath) return { success: false }
    try {
      exportMarks(getDb(), result.filePath)
      return { success: true, path: result.filePath }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('marks:import', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (result.canceled || !result.filePaths[0]) return null
    return importMarks(getDb(), result.filePaths[0])
  })

  // ── Admin ──────────────────────────────────────────────────────────────────

  ipcMain.handle('admin:auditImages', () => {
    const targetRoot = db ? getConfig(db, 'target_root') : null
    if (!targetRoot) return []
    return runImageAudit(
      getDb(),
      targetRoot,
      getProfileModules(getDb()).map((m) => ({
        code: m.code,
        stations: m.stations.map((s) => ({
          number: s.station_number,
          has_conclusion: s.form_fields.some((field) => field.field_id.toUpperCase().includes('CONCLUSION'))
        }))
      }))
    )
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

  ipcMain.handle(
    'admin:copyFileToStation',
    (_e, srcPath: string, student_id: string, module_code: string, station_number: number, slot: 'img1' | 'img2' | 'conclusion') => {
      const targetRoot = db ? getConfig(db, 'target_root') : null
      if (!targetRoot) return { success: false, reason: 'No target root configured' }

      const destDir = join(targetRoot, student_id, module_code, 'Practical', `Station ${station_number}`)
      if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true })

      const ext = basename(srcPath).includes('.') ? '.' + basename(srcPath).split('.').pop()! : ''
      const shortId = student_id.slice(-6)
      const destName = slot === 'conclusion' ? `CONCLUSION_${shortId}${ext}` : basename(srcPath)
      const destPath = join(destDir, destName)
      try {
        copyFileSync(srcPath, destPath)
        return { success: true, destPath }
      } catch (err) {
        return { success: false, reason: String(err) }
      }
    }
  )
}
