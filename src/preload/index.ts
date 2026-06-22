import { contextBridge, ipcRenderer } from 'electron'
import type { AppUpdateStatus } from '../types/ipc'

// Typed IPC bridge — renderer calls window.api.xxx(args)
const api = {
  // Config
  configGet: (key: string) => ipcRenderer.invoke('config:get', key),
  configSet: (key: string, value: string) => ipcRenderer.invoke('config:set', key, value),

  // Setup
  selectFolder: () => ipcRenderer.invoke('setup:selectFolder'),
  selectFile: (filters?: Electron.FileFilter[]) => ipcRenderer.invoke('setup:selectFile', filters),
  autoLoad: (): Promise<{ configured: boolean; config?: { target_root: string; reference_images_root: string; source_path?: string }; error?: string }> =>
    ipcRenderer.invoke('setup:autoLoad'),
  getAppConfig: (): Promise<{ target_root: string; reference_images_root: string; source_path?: string } | null> =>
    ipcRenderer.invoke('setup:getConfig'),
  saveAppConfig: (cfg: { target_root: string; reference_images_root: string; source_path?: string }): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('setup:saveConfig', cfg),

  // Updates
  getUpdateStatus: (): Promise<AppUpdateStatus> => ipcRenderer.invoke('updates:getStatus'),
  checkForUpdates: (): Promise<AppUpdateStatus> => ipcRenderer.invoke('updates:check'),
  installUpdate: (): Promise<{ success: boolean; error?: string }> => ipcRenderer.invoke('updates:install'),
  onUpdateStatus: (callback: (status: AppUpdateStatus) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, status: AppUpdateStatus): void => callback(status)
    ipcRenderer.on('updates:status', listener)
    return () => ipcRenderer.removeListener('updates:status', listener)
  },

  // Assessment profiles
  getActiveProfileConfig: () => ipcRenderer.invoke('profiles:getActiveConfig'),
  listProfiles: () => ipcRenderer.invoke('profiles:list'),
  createProfile: (name: string) => ipcRenderer.invoke('profiles:create', name),
  setActiveProfile: (profileId: string) => ipcRenderer.invoke('profiles:setActive', profileId),
  getStationDefinition: (moduleCode: string, stationNumber: number) =>
    ipcRenderer.invoke('profiles:getStation', moduleCode, stationNumber),
  saveProfileConfig: (cfg: unknown) => ipcRenderer.invoke('profiles:saveConfig', cfg),
  setAdminPin: (profileId: string, pin: string) => ipcRenderer.invoke('profiles:setAdminPin', profileId, pin),
  verifyAdminPin: (profileId: string, pin: string) => ipcRenderer.invoke('profiles:verifyAdminPin', profileId, pin),
  exportProfilePackage: () => ipcRenderer.invoke('profiles:exportPackage'),
  importProfilePackage: (forceReplace: boolean) => ipcRenderer.invoke('profiles:importPackage', forceReplace),

  // CSV
  importCsv: (filePath: string) => ipcRenderer.invoke('csv:import', filePath),
  previewStudentCsv: (filePath: string) => ipcRenderer.invoke('csv:previewStudents', filePath),

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
  getDashboardProgress: (examiner_name: string) => ipcRenderer.invoke('dashboard:progress', examiner_name),

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
    img1_mark: number | null,
    img2_mark: number | null,
    conclusion_mark: number | null,
    has_conclusion: boolean
  ) =>
    ipcRenderer.invoke(
      'marking:saveMark',
      student_id, module_code, station_number,
      examiner_name, img1_mark, img2_mark, conclusion_mark, has_conclusion
    ),

  saveFormMark: (
    student_id: string,
    module_code: string,
    station_number: number,
    examiner_name: string,
    responses: Array<{
      field_id: string
      field_type: 'score' | 'text'
      value_num?: number | null
      value_text?: string | null
    }>
  ) =>
    ipcRenderer.invoke(
      'marking:saveFormMark',
      student_id, module_code, station_number, examiner_name, responses
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

  saveDynamicConsensus: (
    student_id: string,
    module_code: string,
    station_number: number,
    examiner_name: string,
    responses: Array<{
      field_id: string
      field_type: 'score' | 'text'
      value_num?: number | null
      value_text?: string | null
    }>
  ) =>
    ipcRenderer.invoke(
      'resolution:saveDynamicConsensus',
      student_id, module_code, station_number,
      examiner_name, responses
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
  ) => ipcRenderer.invoke('admin:copyFileToStation', srcPath, student_id, module_code, station_number, slot),

  // DICOM / Orthanc
  getDicomConfig: () => ipcRenderer.invoke('dicom:getConfig'),
  saveDicomConfig: (cfg: { orthanc_base_url: string; ohif_base_url: string }) =>
    ipcRenderer.invoke('dicom:saveConfig', cfg),
  testDicomConnection: (cfg: { orthanc_base_url: string; ohif_base_url: string }) =>
    ipcRenderer.invoke('dicom:testConnection', cfg),
  uploadDicomFolder: (cfg: { orthanc_base_url: string; ohif_base_url: string }, folderPath: string) =>
    ipcRenderer.invoke('dicom:uploadFolder', cfg, folderPath),
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
