import { existsSync, readdirSync } from 'fs'
import { join, extname } from 'path'
import type Database from 'better-sqlite3'
import type { AuditEntry } from '../types/ipc'

const IMAGE_EXTS = new Set(['.tif', '.tiff', '.jpg', '.jpeg', '.png'])

interface StationConfig {
  number: number
  has_conclusion: boolean
}

interface ModuleConfig {
  code: string
  stations: StationConfig[]
}

export function runImageAudit(
  db: Database.Database,
  targetRoot: string,
  modulesConfig: ModuleConfig[]
): AuditEntry[] {
  const students = db
    .prepare(
      'SELECT student_id, full_name, module_code FROM students ORDER BY module_code, full_name'
    )
    .all() as { student_id: string; full_name: string; module_code: string }[]

  const moduleStationsMap = new Map<string, StationConfig[]>()
  for (const mod of modulesConfig) {
    moduleStationsMap.set(mod.code, mod.stations)
  }

  const entries: AuditEntry[] = []

  for (const student of students) {
    const stations = moduleStationsMap.get(student.module_code)
    if (!stations) continue

    for (const station of stations) {
      const stationDir = join(
        targetRoot,
        student.student_id,
        student.module_code,
        'Practical',
        `Station ${station.number}`
      )

      const dirExists = existsSync(stationDir)
      let img1: string | null = null
      let img2: string | null = null
      let conclusion: string | null = null

      if (dirExists) {
        let files: string[]
        try {
          files = readdirSync(stationDir)
        } catch {
          files = []
        }

        const images: string[] = []
        for (const f of files) {
          const ext = extname(f).toLowerCase()
          const nameLower = f.toLowerCase()
          if (nameLower.startsWith('conclusion_')) {
            conclusion = f
          } else if (/form/i.test(f)) {
            if (!conclusion) conclusion = f
          } else if (IMAGE_EXTS.has(ext)) {
            images.push(f)
          } else if (ext === '.pdf' && !conclusion) {
            conclusion = f
          }
        }
        images.sort((a, b) => a.localeCompare(b))
        img1 = images[0] ?? null
        img2 = images[1] ?? null
      }

      entries.push({
        student_id: student.student_id,
        full_name: student.full_name,
        module_code: student.module_code,
        station_number: station.number,
        station_dir: stationDir,
        dir_exists: dirExists,
        img1,
        img2,
        conclusion,
        requires_conclusion: station.has_conclusion
      })
    }
  }

  return entries
}
