PEI Mutual Residential Rental Inspection — EXPORT VERSION

Replace in your existing project:
- index.html
- styles.css
- app.js

Keep:
- data/inspection-rules.js
A matching copy is included.

NEW EXPORT FUNCTION
- "Export PDF" button in header
- Optional inclusion of:
  * satisfactory items
  * N/A and Not Inspected items
  * photos
  * code / inspector guidance
- Creates a clean print-ready inspection report
- Includes property details, rated inspection items, observations, photos, fire-section selections, summary, overall risk, reference standards and disclaimer
- Automatically opens the browser print dialog

ON IPAD
1. Tap Export PDF.
2. Choose report options.
3. Tap Create PDF Report.
4. Safari opens the print preview.
5. Pinch outward on the document preview to open it as a PDF.
6. Tap Share.
7. Save to Files/iCloud Drive/OneDrive/email/etc.

WHY PRINT-TO-PDF
This uses the browser's native PDF rendering rather than an external JavaScript PDF library.
That keeps the GitHub Pages app simple, reliable, and free of third-party dependencies.

DEPLOY
1. Replace index.html, styles.css and app.js.
2. Commit and push.
3. Wait for GitHub Pages deployment.
4. Hard-refresh the page.
