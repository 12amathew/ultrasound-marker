import React from 'react'
import { useAppStore } from './store/appStore'
import LoginPage from './pages/LoginPage'
import SetupPage from './pages/SetupPage'
import DashboardPage from './pages/DashboardPage'
import StudentListPage from './pages/StudentListPage'
import MarkingPage from './pages/MarkingPage'
import ResolutionPage from './pages/ResolutionPage'
import AdminPage from './pages/AdminPage'
import UpdateStatus from './components/UpdateStatus'

export default function App(): React.JSX.Element {
  const screen = useAppStore((s) => s.screen)

  let page: React.JSX.Element

  switch (screen) {
    case 'login':
      page = <LoginPage />
      break
    case 'setup':
      page = <SetupPage />
      break
    case 'dashboard':
      page = <DashboardPage />
      break
    case 'studentList':
      page = <StudentListPage />
      break
    case 'marking':
      page = <MarkingPage />
      break
    case 'resolution':
      page = <ResolutionPage />
      break
    case 'admin':
      page = <AdminPage />
      break
    default:
      page = <LoginPage />
  }

  return (
    <>
      {page}
      <UpdateStatus />
    </>
  )
}
