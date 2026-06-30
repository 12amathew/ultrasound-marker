# Ultrasound Marker Documentation

Ultrasound Marker is a desktop application for preparing, marking, resolving, and exporting ultrasound practical assessment results. It is designed for assessments where students complete ultrasound stations, examiners independently mark the station images, and disagreements are resolved before final results are exported.

This documentation is split for two audiences.

## Start here

- [Admin User Guide](./admin-user-guide.md)
  - For assessment administrators and exam leads.
  - Explains setup, assessment profiles, students, examiners, image preparation, DICOM sync, audit, mark exchange, resolution, and final export.
  - Assumes very little technical knowledge.

- [Technical Architecture Guide](./technical-architecture.md)
  - For developers, maintainers, technical support, and people who need to understand how the app is built.
  - Explains the Electron/React/SQLite architecture, data model, IPC boundaries, file formats, marking state machine, DICOM integration, packaging, and operational risks.
  - Also written in plain language, with technical terms explained.

## Very short summary

The app has three main jobs:

1. Prepare the assessment:
   - Configure folders.
   - Create or import an assessment profile.
   - Import students and assign them to modules.
   - Configure examiners, stations, rubrics, candidate instructions, and DICOM mappings.
   - Sort or link images so every student station has the required material.

2. Mark and resolve:
   - Examiners log in by selecting their name.
   - Each examiner marks student station images independently.
   - The app compares marks once two examiners have marked the same student station.
   - Marks within the allowed tolerance are automatically agreed.
   - Marks outside tolerance appear in the resolution queue.

3. Export results:
   - Admins export final results to Excel.
   - In multi-laptop workflows, one examiner can export marks to JSON and another can import them.

## Main screens

- Login: choose examiner, open setup, or open admin.
- Setup: configure folder paths, import student CSV, and optionally sort raw files.
- Dashboard: see marking progress by module and station.
- Student List: view all students for a station and filter by marking state.
- Marking: compare student images with reference images and enter scores.
- Resolution: compare two examiner marks and enter final consensus marks.
- Admin: manage assessment profiles, files, DICOM, audits, mark sync, and reset.

## Important vocabulary

- Assessment profile: the complete configuration for one assessment. It includes modules, stations, rubrics, students, examiners, and DICOM mapping rules.
- Module: an assessment area, such as AS, FC, NB, HD, LM, or PR in the seeded legacy profile.
- Station: a numbered practical assessment task inside a module.
- Rubric field: a markable item on a station form, such as Image 1, Image 2, or Conclusion.
- Tolerance: how far apart the two examiner marks can be while still being treated as agreed.
- Target root: the main folder containing prepared student assessment files.
- Reference images root: the folder containing reference images used during marking.
- Orthanc: a DICOM server used to store and serve ultrasound DICOM studies.
- OHIF: a web viewer used to open full DICOM studies.

