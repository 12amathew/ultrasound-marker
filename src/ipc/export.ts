import ExcelJS from 'exceljs'
import type Database from 'better-sqlite3'
import { getActiveProfileId, getProfileModules } from '../db/queries'

interface StudentResult {
  student_id: string
  full_name: string
}

interface ExaminerResponseRow {
  examiner_name: string
  field_id: string
  field_type: 'score' | 'text'
  value_num: number | null
  value_text: string | null
  marked_at: string
}

interface ResolvedResponseRow {
  field_id: string
  value_num: number
  resolution_type: string
}

export async function exportResults(db: Database.Database, outputPath: string): Promise<void> {
  const profileId = getActiveProfileId(db)
  const modules = getProfileModules(db, profileId)
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Ultrasound Marker'
  workbook.created = new Date()

  const summary = workbook.addWorksheet('Summary')
  summary.properties.defaultColWidth = 20
  const summaryHeader = summary.addRow([
    'Student ID',
    'Full Name',
    'Module',
    'Total Score',
    'Max Score',
    'Percentage'
  ])
  summaryHeader.font = { bold: true }
  summaryHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD3D3D3' } }

  for (const mod of modules) {
    const students = db
      .prepare(
        `SELECT ps.student_id, ps.full_name
         FROM profile_students ps
         JOIN student_enrollments se
          ON se.profile_id = ps.profile_id AND se.student_id = ps.student_id
         WHERE ps.profile_id = ? AND se.module_code = ?
         ORDER BY ps.full_name`
      )
      .all(profileId, mod.code) as StudentResult[]

    if (students.length === 0) continue

    const sheet = workbook.addWorksheet(mod.code)
    sheet.properties.defaultColWidth = 14

    const headers: string[] = ['Student ID', 'Full Name']
    for (const station of mod.stations) {
      for (const field of station.form_fields) {
        if (field.field_type === 'score') {
          headers.push(`S${station.station_number} ${field.label} (E1)`)
          headers.push(`S${station.station_number} ${field.label} (E2)`)
          headers.push(`S${station.station_number} ${field.label} Final`)
        } else {
          headers.push(`S${station.station_number} ${field.label} (E1)`)
          headers.push(`S${station.station_number} ${field.label} (E2)`)
        }
      }
      headers.push(`S${station.station_number} Agreement`)
      headers.push(`S${station.station_number} Score`)
      headers.push(`S${station.station_number} Max`)
      headers.push(`S${station.station_number} %`)
      headers.push(`S${station.station_number} E1 Name`)
      headers.push(`S${station.station_number} E2 Name`)
    }
    headers.push('Total Score')
    headers.push('Max Score')
    headers.push('Percentage')
    headers.push('Examiners')

    const headerRow = sheet.addRow(headers)
    headerRow.font = { bold: true }
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD3D3D3' } }

    for (const student of students) {
      const row: (string | number | null)[] = [student.student_id, student.full_name]
      const examinerNames = new Set<string>()
      let totalScore = 0
      let totalMax = 0
      let incomplete = false

      for (const station of mod.stations) {
        const responseRows = db
          .prepare(
            `SELECT examiner_name, field_id, field_type, value_num, value_text, marked_at
             FROM examiner_form_responses
             WHERE profile_id = ? AND student_id = ? AND module_code = ? AND station_number = ?
             ORDER BY marked_at ASC, examiner_name, field_id`
          )
          .all(profileId, student.student_id, mod.code, station.station_number) as ExaminerResponseRow[]

        const resolvedRows = db
          .prepare(
            `SELECT field_id, value_num, resolution_type
             FROM resolved_form_responses
             WHERE profile_id = ? AND student_id = ? AND module_code = ? AND station_number = ?`
          )
          .all(profileId, student.student_id, mod.code, station.station_number) as ResolvedResponseRow[]

        const examinerOrder = [...new Set(responseRows.map((r) => r.examiner_name))]
        const e1 = examinerOrder[0] ?? null
        const e2 = examinerOrder[1] ?? null
        if (e1) examinerNames.add(e1)
        if (e2) examinerNames.add(e2)

        const responseValue = (examiner: string | null, fieldId: string): string | number | null => {
          if (!examiner) return null
          const r = responseRows.find((row) => row.examiner_name === examiner && row.field_id === fieldId)
          return r?.field_type === 'score' ? r.value_num : r?.value_text ?? null
        }
        const finalValue = (fieldId: string): number | null =>
          resolvedRows.find((resolved) => resolved.field_id === fieldId)?.value_num ?? null

        let stationScore = 0
        let stationMax = 0
        let stationIncomplete = false
        for (const field of station.form_fields) {
          if (field.field_type === 'score') {
            const final = finalValue(field.field_id)
            row.push(responseValue(e1, field.field_id) as number | null)
            row.push(responseValue(e2, field.field_id) as number | null)
            row.push(final)
            stationMax += field.max_score ?? 0
            if (final === null) stationIncomplete = true
            else stationScore += final
          } else {
            row.push(responseValue(e1, field.field_id) as string | null)
            row.push(responseValue(e2, field.field_id) as string | null)
          }
        }

        const resolutionType = resolvedRows[0]?.resolution_type ?? null
        row.push(stationIncomplete ? 'INCOMPLETE' : resolutionType === 'agreed' ? 'AGREE' : 'RESOLVED')
        row.push(stationIncomplete ? null : stationScore)
        row.push(stationMax)
        row.push(!stationIncomplete && stationMax > 0 ? Math.round((stationScore / stationMax) * 1000) / 10 : null)
        row.push(e1)
        row.push(e2)

        totalMax += stationMax
        if (stationIncomplete) incomplete = true
        else totalScore += stationScore
      }

      const pct = !incomplete && totalMax > 0 ? Math.round((totalScore / totalMax) * 1000) / 10 : null
      row.push(incomplete ? null : totalScore)
      row.push(totalMax)
      row.push(pct)
      row.push([...examinerNames].join(', '))
      sheet.addRow(row)

      summary.addRow([
        student.student_id,
        student.full_name,
        mod.code,
        incomplete ? null : totalScore,
        totalMax,
        pct
      ])
    }

    sheet.views = [{ state: 'frozen', ySplit: 1 }]
  }

  summary.views = [{ state: 'frozen', ySplit: 1 }]
  await workbook.xlsx.writeFile(outputPath)
}
