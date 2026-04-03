import ExcelJS from 'exceljs'
import type Database from 'better-sqlite3'
import stationsConfig from '../../config/stations.json'

interface StudentResult {
  student_id: string
  full_name: string
  module_code: string
}

interface ExaminerMarkRow {
  examiner_name: string
  img1_mark: number | null
  img2_mark: number | null
  conclusion_mark: number | null
  station_score: number | null
  marked_at: string
}

interface ResolvedMarkRow {
  img1_mark: number
  img2_mark: number
  conclusion_mark: number | null
  station_score: number
  resolution_type: string
}

export async function exportResults(db: Database.Database, outputPath: string): Promise<void> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Ultrasound Marker'
  workbook.created = new Date()

  const summaryRows: {
    student_id: string
    full_name: string
    module: string
    total_score: number | null
    practical_pct: number | null
    result: string
  }[] = []

  for (const mod of stationsConfig.modules) {
    const students = db
      .prepare('SELECT student_id, full_name, module_code FROM students WHERE module_code=? ORDER BY full_name')
      .all(mod.code) as StudentResult[]

    if (students.length === 0) continue

    const sheet = workbook.addWorksheet(mod.code)
    sheet.properties.defaultColWidth = 14

    // ── Build column headers ───────────────────────────────────────────────
    const headers: string[] = ['Student ID', 'Full Name']

    for (const st of mod.stations) {
      const s = st.number
      headers.push(`S${s} IMG1 (E1)`)
      headers.push(`S${s} IMG2 (E1)`)
      if (st.has_conclusion) headers.push(`S${s} Conclusion (E1)`)
      headers.push(`S${s} IMG1 (E2)`)
      headers.push(`S${s} IMG2 (E2)`)
      if (st.has_conclusion) headers.push(`S${s} Conclusion (E2)`)
      headers.push(`S${s} Agreement`)
      headers.push(`S${s} Final IMG1`)
      headers.push(`S${s} Final IMG2`)
      if (st.has_conclusion) headers.push(`S${s} Final Conclusion`)
      headers.push(`S${s} Score`)
      headers.push(`S${s} Resolution`)
    }

    headers.push('Total Practical Score')
    headers.push('Practical %')
    headers.push('Practical Result')
    headers.push('Examiners')

    const headerRow = sheet.addRow(headers)
    headerRow.font = { bold: true }
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD3D3D3' } }

    // ── Populate student rows ──────────────────────────────────────────────
    for (const student of students) {
      const row: (string | number | null)[] = [student.student_id, student.full_name]
      let totalScore: number | null = 0
      let allResolved = true
      const examinerNames = new Set<string>()

      for (const st of mod.stations) {
        const marks = db
          .prepare(
            `SELECT examiner_name, img1_mark, img2_mark, conclusion_mark, station_score, marked_at
             FROM examiner_marks
             WHERE student_id=? AND module_code=? AND station_number=?
             ORDER BY marked_at ASC`
          )
          .all(student.student_id, mod.code, st.number) as ExaminerMarkRow[]

        const resolved = db
          .prepare(
            `SELECT img1_mark, img2_mark, conclusion_mark, station_score, resolution_type
             FROM resolved_marks
             WHERE student_id=? AND module_code=? AND station_number=?`
          )
          .get(student.student_id, mod.code, st.number) as ResolvedMarkRow | undefined

        const e1 = marks[0] ?? null
        const e2 = marks[1] ?? null

        if (e1) examinerNames.add(e1.examiner_name)
        if (e2) examinerNames.add(e2.examiner_name)

        // E1 marks
        row.push(e1?.img1_mark ?? null)
        row.push(e1?.img2_mark ?? null)
        if (st.has_conclusion) row.push(e1?.conclusion_mark ?? null)

        // E2 marks
        row.push(e2?.img1_mark ?? null)
        row.push(e2?.img2_mark ?? null)
        if (st.has_conclusion) row.push(e2?.conclusion_mark ?? null)

        // Agreement
        if (!resolved) {
          row.push('INCOMPLETE')
          allResolved = false
        } else {
          row.push(resolved.resolution_type === 'agreed' ? 'AGREE' : 'DISAGREE')
        }

        // Final marks
        row.push(resolved?.img1_mark ?? null)
        row.push(resolved?.img2_mark ?? null)
        if (st.has_conclusion) row.push(resolved?.conclusion_mark ?? null)
        row.push(resolved?.station_score ?? null)
        row.push(
          !resolved
            ? 'incomplete'
            : resolved.resolution_type === 'agreed'
            ? 'agreed'
            : 'resolved'
        )

        if (resolved) {
          totalScore = (totalScore ?? 0) + resolved.station_score
        } else {
          totalScore = null
          allResolved = false
        }
      }

      const practicalPct =
        totalScore !== null ? Math.round((totalScore / 8) * 100 * 10) / 10 : null

      let result: string
      if (!allResolved) {
        result = 'INCOMPLETE'
      } else if (practicalPct !== null && practicalPct >= 50) {
        result = 'PASS'
      } else {
        result = 'FAIL'
      }

      row.push(totalScore ?? null)
      row.push(practicalPct ?? null)
      row.push(result)
      row.push([...examinerNames].join(', '))

      const dataRow = sheet.addRow(row)

      // Highlight PASS/FAIL
      const resultColIdx = headers.indexOf('Practical Result') + 1
      const resultCell = dataRow.getCell(resultColIdx)
      if (result === 'PASS') {
        resultCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF92D050' } }
      } else if (result === 'FAIL') {
        resultCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFF0000' } }
        resultCell.font = { color: { argb: 'FFFFFFFF' } }
      }

      summaryRows.push({
        student_id: student.student_id,
        full_name: student.full_name,
        module: mod.code,
        total_score: totalScore,
        practical_pct: practicalPct,
        result
      })
    }

    // Freeze header row
    sheet.views = [{ state: 'frozen', ySplit: 1 }]
  }

  // ── Summary sheet ──────────────────────────────────────────────────────────
  const summary = workbook.addWorksheet('Summary')
  summary.properties.defaultColWidth = 20
  const sumHeader = summary.addRow([
    'Student ID', 'Full Name', 'Module',
    'Total Practical Score', 'Practical %', 'Practical Result'
  ])
  sumHeader.font = { bold: true }
  sumHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD3D3D3' } }

  for (const r of summaryRows) {
    const row = summary.addRow([
      r.student_id, r.full_name, r.module,
      r.total_score, r.practical_pct, r.result
    ])
    const resultCell = row.getCell(6)
    if (r.result === 'PASS') {
      resultCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF92D050' } }
    } else if (r.result === 'FAIL') {
      resultCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFF0000' } }
      resultCell.font = { color: { argb: 'FFFFFFFF' } }
    }
  }

  summary.views = [{ state: 'frozen', ySplit: 1 }]

  // Move Summary to first position
  workbook.moveWorksheet('Summary', 1)

  await workbook.xlsx.writeFile(outputPath)
}
