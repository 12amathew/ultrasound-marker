import { contextBridge, ipcRenderer } from 'electron'

// Typed IPC bridge — renderer calls window.api.xxx(args)
const api = {
  // Config
  configGet: (key: string) => ipcRenderer.invoke('config:get', key),
  configSet: (key: string, value: string) => ipcRenderer.invoke('config:set', key, value),

  // Setup
  selectFolder: () => ipcRenderer.invoke('setup:selectFolder'),
  selectFile: (filters?: Electron.FileFilter[]) => ipcRenderer.invoke('setup:selectFile', filters),
  initDb: (dbPath: string) => ipcRenderer.invoke('setup:initDb', dbPath),
  loadExistingDb: (dbPath: string) => ipcRenderer.invoke('setup:loadExistingDb', dbPath),

  // CSV
  importCsv: (filePath: string) => ipcRenderer.invoke('csv:import', filePath),

  // File sorter
  runFileSort: (sourcePath: string, targetRoot: string) =>
    ipcRenderer.invoke('filesorter:run', sourcePath, targetRoot),

  findConclusions: (assessmentRoot: string, targetRoot: string) =>
    ipcRenderer.invoke('filesorter:findConclusions', assessmentRoot, targetRoot),

  // Students
  getStudentsByModule: (module_code: string) =>
    ipcRenderer.invoke('students:byModule', module_code),

  getStudentsWithState: (module_code: string, station_number: number) =>
    ipcRenderer.invoke('students:withState', module_code, station_number),

  // Dashboard
  getDashboardProgress: () => ipcRenderer.invoke('dashboard:progress'),

  // Marking
  getNextStudent: (
    module_code: string,
    station_number: number,
    examiner_name: string,
    skipList: string[]
  ) => ipcRenderer.invoke('marking:nextStudent', module_code, station_number, examiner_name, skipList),

  acquireLock: (
    student_id: string,
    module_code: string,
    station_number: number,
    examiner_name: string
  ) => ipcRenderer.invoke('marking:acquireLock', student_id, module_code, station_number, examiner_name),

  releaseLock: (student_id: string, module_code: string, station_number: number) =>
    ipcRenderer.invoke('marking:releaseLock', student_id, module_code, station_number),

  saveMark: (
    student_id: string,
    module_code: string,
    station_number: number,
    examiner_name: string,
    img1_mark: number,
    img2_mark: number,
    conclusion_mark: number | null,
    has_conclusion: boolean
  ) =>
    ipcRenderer.invoke(
      'marking:saveMark',
      student_id, module_code, station_number,
      examiner_name, img1_mark, img2_mark, conclusion_mark, has_conclusion
    ),

  getMarkingState: (student_id: string, module_code: string, station_number: number) =>
    ipcRenderer.invoke('marking:getState', student_id, module_code, station_number),

  // Resolution
  getDisagreements: (module_code: string, station_number: number) =>
    ipcRenderer.invoke('resolution:getDisagreements', module_code, station_number),

  getExaminerMarks: (student_id: string, module_code: string, station_number: number) =>
    ipcRenderer.invoke('resolution:getMarks', student_id, module_code, station_number),

  saveConsensus: (
    student_id: string,
    module_code: string,
    station_number: number,
    examiner_name: string,
    img1_mark: number,
    img2_mark: number,
    conclusion_mark: number | null,
    has_conclusion: boolean
  ) =>
    ipcRenderer.invoke(
      'resolution:saveConsensus',
      student_id, module_code, station_number,
      examiner_name, img1_mark, img2_mark, conclusion_mark, has_conclusion
    ),

  // Images
  getStudentImages: (student_id: string, module_code: string, station_number: number) =>
    ipcRenderer.invoke('images:getStudentImages', student_id, module_code, station_number),

  getReferenceImages: (module_code: string, station_number: number) =>
    ipcRenderer.invoke('images:getReferenceImages', module_code, station_number),

  readImageFile: (filePath: string) => ipcRenderer.invoke('images:readFile', filePath),

  // Export
  exportResults: () => ipcRenderer.invoke('export:results'),

  // Logs
  getFileSortLog: () => ipcRenderer.invoke('log:getFileSortLog'),

  // Marks sync
  exportMarks: () => ipcRenderer.invoke('marks:export'),
  importMarks: () => ipcRenderer.invoke('marks:import'),
  resetMarks: () => ipcRenderer.invoke('marks:reset'),

  // Admin
  auditImages: () => ipcRenderer.invoke('admin:auditImages'),
  copyFileToStation: (
    srcPath: string,
    student_id: string,
    module_code: string,
    station_number: number,
    slot: 'img1' | 'img2' | 'conclusion'
  ) => ipcRenderer.invoke('admin:copyFileToStation', srcPath, student_id, module_code, station_number, slot)
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore
  window.api = api
}

export type Api = typeof api
