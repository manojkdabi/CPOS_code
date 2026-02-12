# CPOS_code
CPOS code files

## Quick Start - Fix Questionnaire Not Loading Issue

If you're seeing "Questionnaire unavailable" and a frozen Start button, follow these steps:

### Option 1: Auto-Initialization (Recommended)
The system will now **automatically initialize** missing tables when you load the web app. Simply:
1. Deploy your web app (or reload if already deployed)
2. Open the web app in your browser
3. The system will detect missing tables and create them with sample data
4. Refresh the page to see the questionnaire working

### Option 2: Manual Initialization
If auto-initialization doesn't work, you can manually initialize the tables:

1. Open your Google Spreadsheet
2. Go to **Extensions > Apps Script**
3. In the Script Editor, find the function dropdown (usually says "Select function")
4. Select and run one of these functions:
   - `INIT_ALL_CPOS_TABLES()` - Initializes everything (Recommended)
   - `INIT_LITE_TABLES()` - Only initializes Lite tables (Bounds, Desirability, Weights)
   - `INIT_QUESTIONNAIRE_SHEETS()` - Only initializes Questionnaire tables
5. Click the **Run** button (▶️)
6. Grant necessary permissions when prompted
7. Check the Execution log (View > Logs) to confirm success
8. Reload your web app

### What Gets Created

When you run initialization, the following sheets are created with sample data:

**CPOS Lite Tables:**
- `CPOS_Lite_Bounds` - Factor boundaries and classification ranges
- `CPOS_Lite_Desirability` - Desirability scores for each class
- `CPOS_Lite_Weights` - Sensitivity weights for each factor

**Questionnaire Tables:**
- `CPOS_Q_Bank` - Question definitions
- `CPOS_Q_Options` - Answer options for questions
- `CPOS_Q_Derivation_Rules` - Rules to derive signals from answers
- `CPOS_Q_Routing_Rules` - Conditional routing between questions
- `CPOS_Q_Signal_to_LiteFactor_Map` - Mapping from signals to Lite factors

### Files

- `CPOS_100226_backend` - Backend JavaScript code (Google Apps Script)
- `CPOS_100226_frontend` - Frontend HTML/JavaScript code
- Other files are legacy versions

### Deployment

1. Create a new Google Spreadsheet
2. Go to **Extensions > Apps Script**
3. Copy the contents of `CPOS_100226_backend` into `Code.gs`
4. Create a new HTML file called `Index` (File > New > HTML file)
5. Copy the contents of `CPOS_100226_frontend` into `Index.html`
6. Save the project
7. Deploy as web app: **Deploy > New deployment**
   - Type: Web app
   - Execute as: Me
   - Who has access: Anyone (or as needed)
8. Click **Deploy** and copy the web app URL

### Troubleshooting

**Issue: "No active spreadsheet" error**
- Solution: Make sure the script is bound to a spreadsheet (container-bound script)
- Or set `CPOS_SS_ID` in the backend code to your spreadsheet ID

**Issue: Questionnaire still shows as unavailable**
- Check the browser console for error messages
- Verify all sheets were created successfully
- Try running `INIT_ALL_CPOS_TABLES()` manually
- Check that data rows were added to each sheet (not just headers)

**Issue: Start button still frozen**
- The system requires at least 1 question with valid options to enable the questionnaire
- Make sure you have questions in CPOS_Q_Bank with Is_Active = TRUE
- Verify CPOS_Lite_Bounds has data rows
- Check browser console for specific errors

### Adding Your Own Data

After initialization, you can:
1. Add more rows to any of the tables following the sample format
2. Modify existing rows to match your requirements
3. Keep the headers exactly as they are (the system uses them to parse data)

### Support

For issues or questions, check:
- Browser console logs (F12 > Console)
- Apps Script execution logs (View > Logs in Script Editor)
- Sheet data - make sure headers match expected format
