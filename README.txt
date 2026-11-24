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
- Optional photo capture or photo-library selection
- Print-ready PDF/report export with selectable report content
- Links to applicable code and inspection reference documents

Exporting on iPad or iPhone
1. Tap Export.
2. Select the report sections and details to include.
3. Tap Create & Share PDF.
4. Choose OneDrive if it appears in the Share Sheet. Otherwise choose Save to
   Files and select a OneDrive folder.

On a computer, exported PDFs and transfer files go to the browser's Downloads
folder by default. In Chrome or Edge, press Ctrl+J to open the downloads list.
Enable “Ask where to save each file” in browser download settings to choose a
different folder, such as a synced OneDrive folder.

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
