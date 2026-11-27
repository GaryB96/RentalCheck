PEI Mutual Residential Rental Inspection

A browser-based inspection checklist for existing residential rental buildings in
Prince Edward Island. It provides a structured visual-inspection workflow for
property details, exterior conditions, interior common areas, dwelling units,
fire and life safety, and building systems.

Inspection items can be rated as satisfactory, deficient, an immediate concern,
requiring further review, not inspected, or not applicable. The app supports
written observations, photos, reference guidance, and section-level summaries.
It can also calculate an overall risk level and identify conditions that need
special attention.

Main features
- Mobile-friendly PWA interface that can be installed on a supported device
- New, open, and local save of inspections using browser IndexedDB storage
- Automatic saving as the inspection is edited
- JSON transfer files for moving editable inspections, including photos, between devices
- Property, fire-safety, and building-condition checklists
- Building grading for base risk, fire-control effectiveness, and public protection, with grading answers saved in each inspection
- Optional photo capture or photo-library selection
- Print-ready PDF/report export with selectable report content
- Links to applicable code and inspection reference documents

Exporting on iPad or iPhone
1. Tap Export.
2. Select the report sections and details to include.
3. Tap Create & Share PDF.
4. Choose OneDrive if it appears in the Share Sheet. Otherwise choose Save to
   Files and select a OneDrive folder.

On a computer, the app opens a save dialog for PDFs and transfer files when the
browser supports it. Otherwise, files go to the browser's Downloads folder.
In Chrome or Edge, press Ctrl+J to open the downloads list.

Transferring an inspection between devices
1. On the first device, tap Transfer, then Export File.
2. Share the JSON transfer file to OneDrive if available. Otherwise choose Save
   to Files and select a OneDrive folder, or download it and upload it there.
3. On the other device, open the same app, tap Transfer, then Import File.
4. Select the transfer file from OneDrive or the device's Files/Downloads location.

If OneDrive is not shown in Files on iPad, sign in to the OneDrive app, then
enable its location from Files > Browse > More > Edit.

The transfer file contains editable inspection data and attached photos. Importing
it creates a local copy on the receiving device.

Building grading
1. Select Building Grade from the inspection header.
2. Complete the property measurements and grading questions. Existing property
   answers for construction, units, storeys, and sprinkler status are reused.
3. Review the three scores and any missing-answer warning. A score remains
   provisional until its required answers are complete.
4. In Export, include the main grade scores, the full grading breakdown, or both.

The base risk score is out of 5 and uses Fire Severity (40%), Fire Probability
(25%), Water Damage Exposure (20%), and Management (15%). Fire Control
Effectiveness is out of 10.5; Public Protection is out of 8. Fire Control
Effectiveness adds 0.5 points for each of the five portable-extinguisher
locations selected in Section 7. “None observed” and “Applicability uncertain”
add no points, but either counts as an answered extinguisher assessment.
Grading answers are stored with the inspection and included in transfer files.
Higher scores indicate lower risk or stronger protection.

Enter building length and width in feet in Section 1. For the estimate, the app
assumes a rectangular footprint: length × width. It estimates total floor area
as above-grade storeys × (length × width), and shows the formula with the result
in Building Grade. The dwelling-unit bands use 25–49 units for 2 points and 50
or more for 1 point. Adjacent-building material modifies the distance score only
when the distance is under 80 ft.
Partial sprinkler coverage is selected separately when the Property Information
sprinkler answer is No; Public Protection then uses the non-sprinklered
fire-hall bands.
The Section 7 fire-alarm answer also feeds Fire Control Effectiveness: no system
scores 0, local scores 1, and monitored (dials out) scores 2.

Data and privacy
Inspection records and photos are stored locally in the current browser and are
not uploaded to an application server. Clearing browser data can remove saved
inspections, so export important reports or create transfer-file backups as needed.
Transfer files may contain sensitive property information; store and share them
securely.

Deployment
Host the RentalCheck folder through a static web server or GitHub Pages. Keep
the HTML, CSS, JavaScript, data, icon, and references folders together so the
PWA, checklist rules, and linked reference PDFs load correctly.
