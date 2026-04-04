import { create } from 'zustand'
import type { ModuleProgress } from '../types/ipc'

export type AppScreen = 'login' | 'setup' | 'dashboard' | 'studentList' | 'marking' | 'resolution' | 'admin'

export const EXAMINERS = ['Ian Stell', 'Giles Cattermole', 'George Nada'] as const
export type ExaminerName = (typeof EXAMINERS)[number]

/** Modules each examiner is assigned to mark. null means all modules. */
export const EXAMINER_MODULES: Record<ExaminerName, string[] | null> = {
  'Ian Stell': null,
  'Giles Cattermole': ['HD', 'AS', 'LM'],
  'George Nada': ['FC', 'NB', 'PR']
}

interface MarkingContext {
  module_code: string
  module_name: string
  station_number: number
  has_conclusion: boolean
  conclusion_reference_text: string | null
  candidate_instructions: string | null
}

interface AppState {
  // Session
  screen: AppScreen
  examinerName: ExaminerName | null
  setupIsEdit: boolean

  // Navigation context
  markingContext: MarkingContext | null
  resolutionContext: MarkingContext | null
  studentListContext: MarkingContext | null

  // Currently selected student (for direct marking from student list)
  selectedStudent: { student_id: string; full_name: string } | null

  // Dashboard data
  dashboardProgress: ModuleProgress[]

  // In-session skip list (reset when leaving a station's queue)
  skipList: string[]

  // Actions
  setExaminer: (name: ExaminerName) => void
  setScreen: (screen: AppScreen) => void
  openSetupFresh: () => void
  openSetupEdit: () => void
  openMarkingPage: (ctx: MarkingContext) => void
  openResolutionPage: (ctx: MarkingContext) => void
  openStudentList: (ctx: MarkingContext) => void
  openMarkingForStudent: (student: { student_id: string; full_name: string }) => void
  setDashboardProgress: (progress: ModuleProgress[]) => void
  addToSkipList: (student_id: string) => void
  clearSkipList: () => void
}

export const useAppStore = create<AppState>((set) => ({
  screen: 'login',
  examinerName: null,
  setupIsEdit: false,
  markingContext: null,
  resolutionContext: null,
  studentListContext: null,
  selectedStudent: null,
  dashboardProgress: [],
  skipList: [],

  setExaminer: (name) => set({ examinerName: name, screen: 'dashboard' }),
  setScreen: (screen) => set({ screen }),
  openSetupFresh: () => set({ screen: 'setup', setupIsEdit: false }),
  openSetupEdit: () => set({ screen: 'setup', setupIsEdit: true }),

  openMarkingPage: (ctx) =>
    set({ markingContext: ctx, screen: 'marking', skipList: [], selectedStudent: null }),

  openResolutionPage: (ctx) =>
    set({ resolutionContext: ctx, screen: 'resolution' }),

  openStudentList: (ctx) =>
    set({ studentListContext: ctx, screen: 'studentList' }),

  openMarkingForStudent: (student) =>
    set({ selectedStudent: student, screen: 'marking', skipList: [] }),

  setDashboardProgress: (progress) => set({ dashboardProgress: progress }),

  addToSkipList: (student_id) =>
    set((state) => ({ skipList: [...state.skipList, student_id] })),

  clearSkipList: () => set({ skipList: [] })
}))
