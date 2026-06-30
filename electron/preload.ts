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

  // Students
  getStudentsByModule: (module_code: string) =>
    ipcRenderer.invoke('students:byModule', module_code),

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

  // Assessment profiles
  deleteProfile: (profileId: string) => ipcRenderer.invoke('profiles:delete', profileId),

  // DICOM / Orthanc
  getDicomConfig: () => ipcRenderer.invoke('dicom:getConfig'),
  saveDicomConfig: (cfg: { orthanc_base_url: string; ohif_base_url: string }) =>
    ipcRenderer.invoke('dicom:saveConfig', cfg),
  testDicomConnection: (cfg: { orthanc_base_url: string; ohif_base_url: string }) =>
    ipcRenderer.invoke('dicom:testConnection', cfg),
  uploadDicomFolder: (cfg: { orthanc_base_url: string; ohif_base_url: string }, folderPath: string) =>
    ipcRenderer.invoke('dicom:uploadFolder', cfg, folderPath),
  prepareDicomExportFolder: (folderPath: string) =>
    ipcRenderer.invoke('dicom:prepareUploadExportFolder', folderPath),
  uploadPreparedDicomExportFolder: (
    cfg: { orthanc_base_url: string; ohif_base_url: string },
    folderPath: string,
    validGroupKeys: string[]
  ) => ipcRenderer.invoke('dicom:uploadPreparedExportFolder', cfg, folderPath, validGroupKeys),
  syncDicomStudies: (cfg: { orthanc_base_url: string; ohif_base_url: string }) =>
    ipcRenderer.invoke('dicom:sync', cfg),
  getDicomLinksForStation: (
    student_id: string,
    module_code: string,
    station_number: number
  ) => ipcRenderer.invoke('dicom:getLinksForStation', student_id, module_code, station_number),
  getDicomStudyPreview: (orthanc_study_id: string) =>
    ipcRenderer.invoke('dicom:getStudyPreview', orthanc_study_id),
  getDicomStudyPreviews: (orthanc_study_id: string, limit?: number) =>
    ipcRenderer.invoke('dicom:getStudyPreviews', orthanc_study_id, limit),
  getDicomUnresolved: (limit?: number) => ipcRenderer.invoke('dicom:getUnresolved', limit),
  getDicomUnresolvedDetails: (unresolved_id: number) =>
    ipcRenderer.invoke('dicom:getUnresolvedDetails', unresolved_id),
  linkUnresolvedDicomToStation: (
    unresolved_id: number,
    student_id: string,
    module_code: string,
    station_number: number
  ) => ipcRenderer.invoke('dicom:linkUnresolvedToStation', unresolved_id, student_id, module_code, station_number),
  unlinkDicomStudyLink: (link_id: number, restore_unresolved: boolean) =>
    ipcRenderer.invoke('dicom:unlinkStudyLink', link_id, restore_unresolved),
  refreshDicomLinkPreviewState: (link_id: number) =>
    ipcRenderer.invoke('dicom:refreshLinkPreviewState', link_id)
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
