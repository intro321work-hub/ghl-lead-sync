// One-time setup: writes the header row to the "Leads" tab of your sheet.
//   npm run setup-sheet   (reads SHEET_ID and GOOGLE_SERVICE_ACCOUNT_JSON from .env)

import { SheetsLeadStore } from "../src/sheets.js";

SheetsLeadStore.fromEnv()
  .writeHeader()
  .then(() => console.log("Header row written. Your sheet is ready."))
  .catch((err) => {
    console.error("Setup failed:", err.message);
    console.error("Check that the sheet is shared with the service account email and has a tab named 'Leads'.");
    process.exit(1);
  });
