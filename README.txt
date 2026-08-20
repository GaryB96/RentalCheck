PEI Mutual Residential Rental Inspection — SAVE / OPEN VERSION

Replace these files in your existing project:
- index.html
- styles.css
- app.js

Your existing:
- data/inspection-rules.js
can remain unchanged. A matching copy is also included here for convenience.

WHAT CHANGED
- Multiple saved inspections using IndexedDB
- Open button shows a searchable saved-inspection list
- Each record displays address, inspection date, owner/insured and last-saved time
- Saved inspections can be reopened
- Saved inspections can be deleted
- Photos are stored with the saved inspection and restored when reopened
- New starts a blank inspection
- After the first manual Save, later changes auto-save after a short delay
- Header shows the current inspection and whether unsaved changes remain

IMPORTANT
Saved inspections live in browser storage on that device/browser. They are not yet synced to another device or exported.
Clearing browser/site data can delete them. Export/backup will be the next development step.

DEPLOY
1. Replace index.html, styles.css, and app.js in your project.
2. Keep the folder name exactly `data` (lowercase).
3. Commit and push to GitHub.
4. Wait for GitHub Pages deployment.
5. Hard-refresh the page.
