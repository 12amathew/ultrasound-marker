# Technical Architecture Guide

This guide explains how Ultrasound Marker is built and how data moves through the app. It is written for maintainers and technical readers, but it avoids assuming deep prior knowledge.

## High-level architecture

Ultrasound Marker is an Electron desktop app.

Electron apps have two main parts:

- Main process:
  - Runs with Node.js access.
  - Talks to the filesystem.
  - Opens native file dialogs.
  - Owns the SQLite database connection.
  - Registers IPC handlers.

- Renderer process:
  - Runs the React user interface.
  - Does not directly access the database or filesystem.
  - Calls `window.api` methods exposed by the preload layer.

The app also has a preload script:

- It safely exposes selected IPC methods to the renderer.
- The renderer calls `window.api.getDashboardProgress(...)`, `window.api.saveFormMark(...)`, and similar methods.
- The preload forwards those calls to Electron IPC channels handled by the main process.

## Main technology stack

- Electron: desktop app shell.
- electron-vite: build and development tooling.
- React: user interface.
- Zustand: in-memory UI state and navigation.
- better-sqlite3: local SQLite database.
- ExcelJS: Excel result export.
- dcmjs: DICOM-related conversion and parsing support.
- UTIF: TIFF rendering in the browser UI.
- electron-updater: packaged app update checks.
- Tailwind CSS: styling.

## Important directories

```text
config/
  stations.json                 Seed data for the legacy/default assessment.

src/
  App.tsx                       Top-level screen switcher.
  main/index.ts                 Electron main process used by the app.
  preload/index.ts              IPC bridge exposed as window.api.
  db/schema.ts                  SQLite schema creation and legacy seeding.
  db/queries.ts                 Database read/write logic and marking state.
  ipc/                          Filesystem, CSV, DICOM, export, and sync handlers.
  pages/                        React screens.
  components/                   Shared React components.
  store/appStore.ts             Zustand state store.
  types/                        Shared TypeScript types.

electron/
  main.ts                       Older/alternate Electron entry still present in the repo.
  preload.ts                    Older/alternate preload entry still present in the repo.

docs/
  README.md
  admin-user-guide.md
  technical-architecture.md
```

The active Electron entry for the current source tree is `src/main/index.ts`, with IPC exposed by `src/preload/index.ts`.

## Runtime startup

At app launch:

1. Electron starts the main process.
2. `app.setName('Ultrasound Marker')` makes dev and packaged builds use a consistent user-data path.
3. The main process registers IPC handlers.
4. The main process creates the browser window.
5. The renderer loads the React app.
6. The Login page calls `window.api.autoLoad()`.
7. The main process reads persisted setup config from:

```text
[Electron userData]/config.json
```

8. The main process opens or creates:

```text
[Electron userData]/marks.db
```

9. `initSchema()` creates missing tables and seeds the legacy profile if needed.
10. The renderer loads the active profile and shows the Login screen.

## Persistent storage

The app stores different kinds of data in different places.

### SQLite database

The main database is:

```text
[Electron userData]/marks.db
```

It stores:

- Students.
- Assessment profiles.
- Modules and aliases.
- Stations.
- Rubric fields.
- Examiners and assignments.
- Examiner marks.
- Resolved marks.
- Marking state.
- Marking locks.
- DICOM server config.
- DICOM study links.
- Unresolved DICOM studies.
- File sort logs.
- Setup config rows.

### JSON setup config

The app also stores a small JSON file:

```text
[Electron userData]/config.json
```

It stores:

- `target_root`
- `reference_images_root`
- optional `source_path`

This file lets the app auto-load setup paths before the database UI is fully active.

### External folders

Admins choose external folders for:

- Assessment files root.
- Reference images root.
- Raw exam source folder.
- DICOM export folders.

The app reads from and copies files into these folders, but they are not embedded inside the SQLite database.

## Database schema overview

The schema contains legacy tables and profile-aware tables.

### Legacy compatibility tables

These support older flows and migration:

- `students`
- `examiner_marks`
- `marking_locks`
- `marking_state`
- `resolved_marks`
- `theory_marks`
- `file_sort_log`
- `app_config`
- `setup_config`
- `excluded_enrollments`

The current dynamic profile flow primarily uses the profile-aware tables listed below.

### Assessment profile tables

- `assessment_profiles`
  - One row per assessment setup.
  - Stores active flag and optional admin PIN hash.

- `assessment_modules`
  - Modules belonging to a profile.

- `assessment_module_aliases`
  - Alternative names for module codes.

- `assessment_stations`
  - Station definitions per module and profile.

- `station_form_fields`
  - Dynamic marking form fields.
  - Fields can be score or text.
  - Score fields include min, max, tolerance, and required flag.

- `reference_assets`
  - Reserved for profile-specific reference asset metadata.

- `profile_students`
  - Student identity per profile.

- `student_enrollments`
  - Student-to-module assignments.

- `assessment_examiners`
  - Examiner names and admin flag.

- `examiner_module_assignments`
  - Which modules each examiner can see.

### Marking tables

- `profile_marking_locks`
  - Prevents two examiners from being assigned the same student station at the same time.

- `profile_marking_state`
  - Stores current station state:
    - `UNMARKED`
    - `FIRST_MARK`
    - `AGREED`
    - `DISAGREEMENT`
    - `RESOLVED`

- `examiner_form_responses`
  - Stores each examiner's dynamic form responses.

- `resolved_form_responses`
  - Stores final agreed or resolved score values.

### DICOM tables

- `dicom_server_config`
  - Orthanc and OHIF base URLs.

- `dicom_import_runs`
  - Summary for each DICOM sync.

- `dicom_study_links`
  - Matched DICOM studies linked to student, module, and station.

- `dicom_unresolved_studies`
  - DICOM studies the app could not match automatically.

- `dicom_station_mappings`
  - Maps DICOM source station numbers to app station numbers.

## Seeded legacy profile

When an empty database is initialized, `initSchema()` calls `seedLegacyProfile()`.

This creates:

- A profile called `Legacy assessment`.
- Modules from `config/stations.json`.
- Module aliases equal to each module code.
- Stations and candidate instructions.
- Default score fields:
  - `IMG1`
  - `IMG2`
  - optional `CONCLUSION`
  - optional `CONCLUSION_NOTE` text field where legacy reference text exists.
- Seeded examiner names.
- Seeded examiner module assignments.

It also migrates legacy students and marks into profile-aware tables where possible.

## Frontend state and navigation

The app uses a Zustand store in `src/store/appStore.ts`.

The store tracks:

- Current screen.
- Logged-in examiner name.
- Whether Setup is in edit mode.
- Current marking, resolution, and student-list context.
- Selected student for direct marking.
- Dashboard progress.
- In-session skip list.

`src/App.tsx` switches screens based on the store's `screen` value.

Main screens:

- `login`
- `setup`
- `dashboard`
- `studentList`
- `marking`
- `resolution`
- `admin`

This is simple in-app navigation, not URL routing.

## IPC boundary

The renderer never imports `better-sqlite3` or `fs` directly. It calls the API exposed by `src/preload/index.ts`.

Examples:

- Renderer calls `window.api.getDashboardProgress(examinerName)`.
- Preload invokes IPC channel `dashboard:progress`.
- Main process handles `dashboard:progress`.
- Main process reads from SQLite using functions in `src/db/queries.ts`.
- Main process returns plain data to the renderer.

This boundary is important because it keeps privileged filesystem and database access in the main process.

## Main IPC groups

### Setup and config

Channels include:

- `setup:autoLoad`
- `setup:getConfig`
- `setup:saveConfig`
- `setup:selectFolder`
- `setup:selectFile`
- `config:get`
- `config:set`

These manage initial setup paths and native file selection.

### Profiles

Channels include:

- `profiles:getActiveConfig`
- `profiles:list`
- `profiles:create`
- `profiles:setActive`
- `profiles:delete`
- `profiles:getStation`
- `profiles:saveConfig`
- `profiles:setAdminPin`
- `profiles:verifyAdminPin`
- `profiles:exportPackage`
- `profiles:importPackage`

These drive the Admin Assessment Profile tab.

### CSV

Channels include:

- `csv:previewStudents`
- `csv:import`

CSV parsing expects:

- `full_name`
- `student_id`
- `module_code_1`
- optional `module_code_2`

Student IDs must be 9 digits after stripping non-digits.

### Marking

Channels include:

- `marking:nextStudent`
- `marking:acquireLock`
- `marking:releaseLock`
- `marking:saveMark`
- `marking:saveFormMark`
- `marking:getState`

The current dynamic flow uses `saveFormMark`, which stores rows in `examiner_form_responses`.

### Resolution

Channels include:

- `resolution:getDisagreements`
- `resolution:getMarks`
- `resolution:saveConsensus`
- `resolution:saveDynamicConsensus`

The current dynamic flow uses `saveDynamicConsensus`, which stores rows in `resolved_form_responses`.

### Images and files

Channels include:

- `images:getStudentImages`
- `images:getReferenceImages`
- `images:readFile`
- `filesorter:run`
- `filesorter:findConclusions`
- `admin:auditImages`
- `admin:copyFileToStation`

The app reads image files as base64 data URLs before sending them to the renderer.

### Marks sync and export

Channels include:

- `marks:export`
- `marks:import`
- `marks:reset`
- `export:results`

`export:results` writes an Excel workbook.

### DICOM

Channels include:

- `dicom:getConfig`
- `dicom:saveConfig`
- `dicom:testConnection`
- `dicom:sync`
- `dicom:uploadFolder`
- `dicom:prepareUploadExportFolder`
- `dicom:uploadPreparedExportFolder`
- `dicom:getLinksForStation`
- `dicom:getStudyPreview`
- `dicom:getStudyPreviews`
- `dicom:getUnresolved`
- `dicom:getUnresolvedDetails`
- `dicom:linkUnresolvedToStation`
- `dicom:unlinkStudyLink`
- `dicom:refreshLinkPreviewState`

## Marking state machine

The central state machine is stored in `profile_marking_state`.

### Initial state

If no row exists for a student/module/station, the app treats it as:

```text
UNMARKED
```

### First examiner saves

When one examiner saves a complete response set:

```text
FIRST_MARK
```

### Second examiner saves

When two examiner response sets exist, the app compares score fields.

For each score field:

- If either required value is missing, it does not agree.
- Otherwise, the absolute difference must be less than or equal to that field's tolerance.

If every score field agrees:

```text
AGREED
```

The final value for each score field is the rounded average of the two examiner values.

If any required score field differs beyond tolerance:

```text
DISAGREEMENT
```

### Resolution

When an examiner or admin enters consensus values on the Resolution page:

```text
RESOLVED
```

The consensus score rows are stored in `resolved_form_responses` with `resolution_type = 'resolved'`.

## Marking queue and locks

The marking queue is designed to reduce accidental duplicate work.

When an examiner opens a station:

1. The app looks for students not already marked by that examiner.
2. It prefers `UNMARKED` students.
3. Then it looks for `FIRST_MARK` students.
4. It excludes students in the in-session skip list.
5. It excludes active locks held by another examiner.

When a student is assigned, the app creates a lock in `profile_marking_locks`.

Lock timeout:

```text
5 minutes
```

If a lock is older than that, it is treated as stale and can be overwritten.

Locks are released when the examiner saves, skips, or leaves the marking page.

## Local image handling

Student images are located under:

```text
[target_root]/[student_id]/[module_code]/Practical/Station [station_number]/
```

The app selects local student images by:

1. Reading files in the station folder.
2. Ignoring conclusion-like files.
3. Keeping supported image extensions.
4. Sorting alphabetically.
5. Using the first file as Image 1 and second as Image 2.

Supported student image extensions:

- `.tif`
- `.tiff`
- `.jpg`
- `.jpeg`
- `.png`

Conclusion files are detected when:

- Filename starts with `CONCLUSION_`, or
- Filename contains `Form`, or
- File is a PDF and no conclusion file has already been found.

Reference images are found in the reference image root with names like:

```text
REF_AS_S8_IMG1.jpg
REF_AS_S8_IMG2.tif
```

Hyphens are normalized to underscores during matching.

## Image rendering

`ImageViewer` supports:

- Standard image data URLs in an `<img>`.
- TIFF data URLs decoded with UTIF and painted to canvas.
- PDF data URLs rendered in an iframe.
- Zoom modal for image and TIFF views.

DICOM preview images are also displayed through `ImageViewer` after the DICOM IPC layer returns preview data URLs.

## File sorter behavior

The file sorter scans a raw source folder recursively.

It recognizes folder names and file names containing:

```text
S[station number][module code][last 6 digits of student ID]
```

Optional prefixes like `P1`, `P6`, or underscores are tolerated.

Examples:

```text
P1S1HD178039
P6_S8_AS_193063
```

The sorter:

1. Parses station, module, and short student ID.
2. Resolves module aliases.
3. Looks up the student in the active profile.
4. Copies up to two images into the target station folder.
5. Copies a conclusion file if present.
6. Logs success or unresolved entries in `file_sort_log`.

It never deletes the source files.

## Image audit behavior

Image audit builds one row per student/module/station.

For each row it checks:

- Whether the station folder exists.
- Whether local image 1 exists.
- Whether local image 2 exists.
- Whether a conclusion file exists when required.
- Whether DICOM links exist.
- Whether the active DICOM link has enough previews.

The UI converts this to:

- OK
- Partial
- Missing

If a DICOM link exists, it is the active image source for marking.

## DICOM integration

The DICOM integration is designed around Orthanc and OHIF.

### Orthanc

Orthanc stores DICOM studies and exposes a REST API. The app uses the Orthanc URL to:

- Test connectivity.
- Upload DICOM instances.
- Scan studies.
- Fetch study metadata.
- Fetch preview images.

### OHIF

OHIF is a viewer for full DICOM studies. The app builds an OHIF URL for linked studies and opens it from the marking or resolution UI.

### Matching rule

The app expects DICOM Patient ID values like:

```text
153883-AS-08
```

The parts are:

- `153883`: last 6 digits of the student ID.
- `AS`: module code or alias.
- `08`: source station number.

The app then:

1. Resolves the module alias.
2. Applies DICOM station mapping if one exists.
3. Finds the student by short ID and module.
4. Creates a row in `dicom_study_links`.

If any step fails, the study is stored in `dicom_unresolved_studies`.

### Manual DICOM resolution

Admins can link unresolved studies from Image Audit. The linked study is then associated with a selected student/module/station.

Admins can unlink a study. They can optionally restore it to the unresolved list.

## Mark export/import

The marks sync format is JSON.

Current format version:

```text
2
```

The payload includes:

- `format_version`
- `profile_id`
- `exported_at`
- `responses`

Each response row includes:

- Student ID.
- Module code.
- Station number.
- Examiner name.
- Field ID.
- Field type.
- Numeric value or text value.
- Marked timestamp.

Import rules:

- The file must be valid JSON.
- Format version must match.
- Profile ID must match the active profile.
- Unknown student/module enrollments are skipped.
- Existing examiner response sets are not overwritten.
- Agreement detection runs after imported responses are saved.

## Result export

`exportResults()` writes an Excel workbook.

It creates:

- A `Summary` sheet.
- One sheet per module.

For each station, module sheets include:

- Examiner 1 value.
- Examiner 2 value.
- Final value for score fields.
- Agreement status.
- Station score.
- Station max.
- Station percentage.
- Examiner names.

At the end of each student row:

- Total score.
- Max score.
- Percentage.
- Examiners.

Incomplete stations do not receive final station or total scores.

## Admin PIN storage

Assessment profiles can store:

- `admin_pin_salt`
- `admin_pin_hash`

PIN creation and verification are handled in `src/ipc/profilePackages.ts`.

The PIN protects entry to the Admin screen in the renderer. It is a workflow protection, not a full device-security boundary.

## Application updates

`src/main/index.ts` configures `electron-updater`.

Behavior:

- In packaged builds, the app checks for updates shortly after startup.
- In development, update status is `unsupported`.
- The renderer can request manual update checks.
- Downloaded updates are installed with `quitAndInstall()`.

Publish configuration lives in `package.json` under `build.publish`.

## Build and run commands

Install dependencies:

```bash
npm install
```

Run in development:

```bash
npm run dev
```

Build:

```bash
npm run build
```

Package:

```bash
npm run package
```

The packaged output directory is configured as:

```text
dist
```

## Operational risks and important notes

### Profile identity matters

Marks exports are tied to `profile_id`. If two laptops have similar-looking profiles but different IDs, mark import will fail. Use the settings package workflow to keep profiles aligned.

### Local paths are machine-specific

`target_root`, `reference_images_root`, and `source_path` are local paths. Another laptop may need its own Setup configuration even if it uses the same assessment profile.

### DICOM links depend on server availability

If Orthanc or OHIF is unavailable, local database rows may still exist, but previews or full study viewing may fail.

### Image ordering is alphabetical

For local images, Image 1 and Image 2 are determined by alphabetical filename order. File naming consistency matters.

### Reset is destructive

`marks:reset` deletes marking and resolution data from the database. It does not delete files or students, but marking progress is lost.

### There are legacy and profile-aware paths

Some older functions and tables still exist. The current UI primarily uses dynamic profile-aware marking tables:

- `examiner_form_responses`
- `resolved_form_responses`
- `profile_marking_state`
- `profile_marking_locks`

When making changes, prefer the profile-aware flow unless deliberately maintaining legacy compatibility.

## Suggested mental model

Think of the app as four layers:

1. User interface:
   - React pages and components.

2. IPC bridge:
   - `window.api` methods in preload.

3. Application services:
   - Main-process handlers and `src/ipc/*` modules.

4. Data layer:
   - SQLite schema and query functions.
   - External image/DICOM folders.

Most feature work crosses all four layers:

- Add a database table or query.
- Add an IPC handler.
- Expose it in preload.
- Call it from a React page.
- Update shared TypeScript types.

