import React from 'react'
import { useAppStore } from './store/appStore'
import LoginPage from './pages/LoginPage'
import SetupPage from './pages/SetupPage'
import DashboardPage from './pages/DashboardPage'
import StudentListPage from './pages/StudentListPage'
import MarkingPage from './pages/MarkingPage'
import ResolutionPage from './pages/ResolutionPage'
import AdminPage from './pages/AdminPage'

export default function App(): React.JSX.Element {
  const screen = useAppStore((s) => s.screen)

  switch (screen) {
    case 'login':
      return <LoginPage />
    case 'setup':
      return <SetupPage />
    case 'dashboard':
      return <DashboardPage />
    case 'studentList':
      return <StudentListPage />
    case 'marking':
      return <MarkingPage />
    case 'resolution':
      return <ResolutionPage />
    case 'admin':
      return <AdminPage />
    default:
      return <LoginPage />
  }
}
