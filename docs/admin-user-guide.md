# Admin User Guide

This guide explains how to use Ultrasound Marker as an assessment administrator. It assumes you are new to the app and may not know the technical terms used by developers.

## What the app is for

Ultrasound Marker helps an assessment team:

1. Set up an assessment.
2. Import students.
3. Prepare student ultrasound images or DICOM studies.
4. Let examiners mark students independently.
5. Detect where examiners agree or disagree.
6. Resolve disagreements.
7. Export final results to Excel.

The app does not replace the clinical judgement of examiners. It organizes the marking workflow and stores the scores.

## What an admin is responsible for

An admin usually does these tasks:

- Configure where the app should find and store files.
- Set up the assessment profile.
- Import or check student details.
- Add or check examiner names and module assignments.
- Prepare local images or DICOM links.
- Run the image audit before marking starts.
- Help examiners exchange marks if they are working on separate laptops.
- Check the dashboard for unresolved disagreements.
- Export final results.

## Basic concepts

### Assessment profile

An assessment profile is the app's complete setup for one assessment. It contains:

- The profile name.
- Modules.
- Stations in each module.
- Candidate instructions for each station.
- Marking fields, such as Image 1 and Image 2.
- Tolerance rules for automatic agreement.
- Students and their module enrollments.
- Examiners and which modules they can mark.
- DICOM station mappings, if DICOM is used.

Only one profile is active at a time. The active profile is the one used for marking, auditing, mark sync, and exports.

### Module

A module is an assessment category. The legacy seeded profile includes examples such as:

- HD: Haemodynamic Assessment
- NB: Nerve Block
- FC: Fundamental Cardiac
- AS: Abdomen for Surgeons
- LM: Lumps and Bumps
- PR: Early Pregnancy Bleeding

Your assessment may use different modules if an admin creates or imports a different profile.

### Station

A station is a numbered practical task inside a module. Each station has:

- A station number.
- A label.
- Candidate instructions.
- Marking fields.
- Optional conclusion requirement.

### Marking state

Every student station is in one of these states:

- Not started: no examiner has marked it yet.
- Awaiting 2nd mark: one examiner has marked it.
- Agreed: two examiners marked it and their marks are close enough.
- Disagreement: two examiners marked it but the marks differ too much.
- Resolved: a final consensus mark has been entered.

## First-time setup

From the Login screen, choose `Edit Setup`.

### Step 1: Configure folders

You must select:

- Assessment files root folder:
  - This is the main prepared assessment folder.
  - The app expects student files to be organized under this folder.

- Reference images folder:
  - This contains the expert or reference images shown beside student images during marking.

You may also select:

- Raw exam source folder:
  - This is usually the copied contents of an ultrasound machine export, USB drive, or raw exam folder.
  - The app can scan this folder and copy images into the correct student station folders.

Click `Save & Continue`.

### Step 2: Import student register

Select the student CSV file. The expected columns are:

- `full_name`
- `student_id`
- `module_code_1`
- `module_code_2`

The app expects student IDs to be 9 digits. It strips spaces and non-digit characters from the ID before checking it.

The module codes are matched against the active profile. Module aliases are allowed if they have been configured in the profile.

After import, check:

- Imported count.
- Skipped rows.
- Error rows.

Click `Continue` when ready. You may skip this step if students are already configured in the active profile.

### Step 3: Sort exam files

If you selected a raw source folder, you can run the file sorter.

The sorter copies files from the raw source folder into the assessment files root. It does not move or delete the original files.

The sorter recognizes station folder or file names containing patterns like:

- `P1S1HD178039`
- `P6_S8_AS_193063`

These contain:

- Station number.
- Module code.
- Last 6 digits of the student ID.

The app uses the student register to turn the short ID into the full student ID.

If some files cannot be matched, they are listed as unresolved. Use the Image Audit tab later to fix those manually.

## Admin screen

Open Admin from the Login screen or Dashboard.

If an admin PIN has been set, the app asks for that PIN before showing the admin tools.

The Admin screen has these tabs:

- Assessment Profile
- Sort Files
- DICOM Sync
- Image Audit
- Sync Marks
- Reset Marks

## Assessment Profile tab

Use this tab to manage the active assessment configuration.

### Profile selection

At the top, choose the active profile. You can:

- Select an existing profile.
- Create a new profile.
- Delete the current profile, as long as another profile exists.
- Rename the profile.
- Set an admin PIN.
- Export or import a settings package.

### Admin PIN

The admin PIN protects the Admin screen. It is useful when examiner laptops are being used by several people.

To set it:

1. Enter a 4 to 12 digit PIN.
2. Click `Save PIN`.

After a PIN is saved, future Admin access requires the PIN.

### Export Settings Package

This saves the active profile settings to a `.umprofile` file.

Use this when:

- You want a backup of the profile.
- You want another laptop to use the same profile.
- You are preparing multiple machines before an assessment.

### Import Settings Package

This imports a `.umprofile` file.

Use normal import first. Use `Force Replace Import` only when you intentionally want to replace matching profile data.

### Modules

The left side lists modules. Select a module to edit it.

For each module you can edit:

- Module name.
- Module aliases.
- DICOM station mappings.

Module aliases are alternative codes that should count as the same module. This helps when imported CSV files or image folders use a slightly different code.

### DICOM station mapping

Some DICOM exports may use station numbers that differ from the station numbers used in the app.

Example:

- DICOM Patient ID says source station `08`.
- In the app, the matching marking station is Station `4`.

Add a mapping so the app knows how to link it.

### Stations

For each station you can edit:

- Station label.
- Candidate instructions.
- Whether the station requires a conclusion form.
- Marking fields.

Station changes are staged until you click `Save Profile`.

### Candidate instructions

Candidate instructions are shown during marking and resolution. They help examiners know what the student was asked to produce.

### Conclusion forms

Enable the conclusion checkbox if the station requires a written answer or conclusion form.

When enabled:

- Marking can show the conclusion form if it exists.
- Image audit expects a conclusion file for that station.
- The marking form includes a conclusion score field.

### Marking fields

A marking field is one item the examiner scores or enters text for.

Score fields have:

- Label.
- Minimum score.
- Maximum score.
- Tolerance.

Text fields have:

- Label.
- Text input.

The tolerance controls automatic agreement. If the two examiner marks differ by no more than the tolerance, the app treats that field as agreed.

For example, if Image 1 has tolerance 1:

- Examiner A gives 7.
- Examiner B gives 8.
- Difference is 1, so the field agrees.

If the difference is 2, it does not agree and the student station needs resolution.

### Examiners

Each examiner appears on the Login screen.

For each examiner, enter:

- Name.
- Module codes they can mark.

Leave the module code box blank if the examiner can mark all modules.

### Students

Students can be:

- Imported from CSV.
- Added manually.
- Edited manually.
- Removed from the staged profile.

For each student, check:

- 9 digit student ID.
- Full name.
- Module enrollment checkboxes.

CSV imports are staged until you click `Save Profile`.

If possible duplicates are found, the app shows a review window. You can include or exclude highlighted rows before staging them.

Important: after editing modules, stations, examiners, or students, click `Save Profile`.

## Sort Files tab

Use this tab after setup if you need to sort or re-sort local image files.

### Sort exam images

This scans a raw source folder and copies recognized image files into the correct student station folder.

Supported image file types:

- `.tif`
- `.tiff`
- `.jpg`
- `.jpeg`
- `.png`

The app copies the first two images alphabetically as Image 1 and Image 2.

If more than two images are found, the first two are copied and the folder is listed as unresolved so an admin can check it.

### Find conclusion forms

This scans an assessment root for files whose names contain `Form`, then copies missing conclusion files into the correct station folders.

Conclusion files may be:

- PDF
- JPG/JPEG
- TIFF/TIF

The app copies conclusion files as `CONCLUSION_[short student ID].[extension]`.

## DICOM Sync tab

Use this tab if the assessment images are stored in DICOM format and served by Orthanc/OHIF.

### Orthanc and OHIF

- Orthanc stores DICOM studies.
- OHIF displays DICOM studies in a browser-based medical image viewer.

The app stores links to studies. It does not copy full DICOM studies into the local marking database.

### Configure URLs

Enter:

- Orthanc REST URL.
- OHIF URL.

Click `Save URLs`.

Click `Test Orthanc` to check that the app can connect.

### Expected DICOM Patient ID format

The app expects DICOM Patient ID values like:

```text
153883-AS-08
```

This means:

- Student short ID: `153883`
- Module code: `AS`
- Source station number: `08`

The app resolves the short ID to a full student ID using the student register.

### Sync DICOM Studies

Click `Sync DICOM Studies` to scan Orthanc.

The app tries to match each study to:

- A student.
- A module.
- A station.

Matched studies become linked to the matching student station. Unmatched studies are shown as unresolved.

### Prepare machine image export

Use this when the machine export contains folders named like:

```text
123456-AA-01
```

The app reviews the folders and reports which station groups are valid.

It can:

- Convert JPG and PNG files to DICOM.
- Normalize existing DICOM files into one study per station folder.
- Skip TIFF files and report them.

After review, click `Upload Valid Groups and Sync`.

### Upload post-exam DICOM export

Use this when you already have a DICOM export folder.

The app uploads files to Orthanc, then you should sync studies so they link to student stations.

## Image Audit tab

Use Image Audit before marking starts.

The audit checks each student station and shows whether it has:

- Local Image 1.
- Local Image 2.
- Required conclusion file.
- Linked DICOM study.

Statuses:

- OK: required material is present.
- Partial: some material is present, but something is missing or DICOM preview is incomplete.
- Missing: no required image material is found.

### Manual local file linking

If a file is missing, click the link action for:

- IMG1
- IMG2
- Conclusion

Choose the correct file. The app copies it into the correct student station folder.

### Manual DICOM linking

If a station should use a DICOM study, click `Link DICOM`.

The resolver shows unresolved DICOM studies with:

- Patient ID.
- Reason it was unresolved.
- Study date.
- Description.
- Modality.
- Preview images if available.

Choose the correct unresolved study and click `Link to station`.

### Refresh and unlink DICOM

For linked DICOM studies you can:

- Refresh preview state.
- Unlink the study.

When unlinking, the app asks whether to restore the study to the unresolved list.

## Sync Marks tab

Use this when examiners are marking on separate laptops.

Typical workflow:

1. Both examiners use the same assessment profile.
2. Both examiners mark independently.
3. Examiner 2 clicks `Export my marks`.
4. Examiner 2 sends the JSON file to Examiner 1.
5. Examiner 1 clicks `Import examiner marks`.
6. The app merges the marks and checks agreement.
7. Disagreements appear on the Dashboard.

Existing marks are not overwritten during import.

The export belongs to a specific assessment profile. If the profile does not match, the import is rejected.

## Reset Marks tab

This is a danger area intended for testing.

It deletes:

- Examiner marks.
- Resolved marks.
- Marking states.
- Marking locks.

It does not delete:

- Students.
- Profiles.
- Image files.

Use it only when you deliberately want to clear marking progress.

## Examiner workflow

After setup, an examiner uses the app like this:

1. Open the app.
2. Select their name on Login.
3. Click `Begin Marking`.
4. On the Dashboard, expand a module.
5. Click `Mark` on a station.
6. Choose a student from the Student List or start marking from the queue.
7. Compare student images with reference images.
8. Enter scores.
9. Click `Save & Next`.

The app automatically skips students already marked by that examiner.

## Resolution workflow

When two examiners disagree beyond tolerance:

1. The Dashboard shows how many stations need resolution.
2. Click `Resolve`.
3. Select a student in the disagreement list.
4. Compare both examiner marks.
5. Re-open images if needed.
6. Enter consensus scores.
7. Click `Save Consensus`.

The student station becomes `Resolved`.

## Exporting final results

From the Dashboard, click `Export Results`.

The app creates an Excel workbook containing:

- Summary sheet.
- One sheet per module.
- Student ID and name.
- Examiner marks.
- Final marks.
- Agreement or resolved status.
- Station totals.
- Module totals.
- Percentages.
- Examiner names.

Incomplete student stations show as incomplete rather than receiving a final total.

## File naming expectations

### Local student images

Student images should end up under:

```text
[assessment files root]/
  [student ID]/
    [module code]/
      Practical/
        Station [number]/
```

Image 1 and Image 2 are selected alphabetically from supported image files in that folder.

### Reference images

Reference images should be named:

```text
REF_[ModuleCode]_S[StationNumber]_IMG1.[extension]
REF_[ModuleCode]_S[StationNumber]_IMG2.[extension]
```

Hyphens are tolerated in place of underscores.

Examples:

```text
REF_AS_S8_IMG1.jpg
REF_AS_S8_IMG2.tif
```

### Conclusion files

Conclusion files are recognized if:

- The filename starts with `CONCLUSION_`, or
- The filename contains `Form`, or
- It is a PDF in the station folder.

## Practical checklist before marking starts

1. Open Admin.
2. Confirm the correct active assessment profile.
3. Confirm modules and stations.
4. Confirm candidate instructions.
5. Confirm marking fields and tolerances.
6. Confirm conclusion stations.
7. Import or check students.
8. Confirm examiner names and module assignments.
9. Configure folder paths in Setup.
10. Sort local images or sync DICOM studies.
11. Run Image Audit.
12. Fix missing or partial entries.
13. Export a settings package backup.
14. Tell examiners they can begin marking.

## Troubleshooting

### No examiners appear on Login

Open Admin and check the active profile. Add examiners in the Assessment Profile tab and save the profile.

### A module does not appear for an examiner

Check the examiner's module assignments. Blank means all modules. Otherwise, the module code must be listed.

### Images do not appear during marking

Check:

- Setup has a valid assessment files root.
- Image Audit shows OK for the student station.
- Local images are in the expected station folder.
- If using DICOM, the study is linked and has preview images.

### Reference images do not appear

Check:

- Setup has a valid reference images folder.
- Reference images are named with the expected `REF_[Module]_S[Station]_IMG[1|2]` pattern.
- The file extension is supported.

### DICOM studies are unresolved

Check:

- Patient ID follows the expected short ID, module, and station pattern.
- Student exists in the active profile.
- Module code or alias exists.
- DICOM station mappings are correct.
- Orthanc URL is reachable.

### Imported marks are rejected

The marks file must belong to the same assessment profile. Import the matching settings package first, or use the same profile on both laptops before marking.

### Dashboard numbers look wrong

Click `Refresh now`. If still wrong, check that:

- The correct examiner is logged in.
- The correct active profile is selected.
- Students are enrolled in the expected modules.
- Marks were imported into the same profile.

