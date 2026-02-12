# 🔧 TROUBLESHOOTING GUIDE - "No Success" Issues

## 🎯 Quick Diagnosis

Since you reported "No success," let me help you identify and fix the specific issue.

## 📋 STEP 1: What's Not Working?

Check which symptom matches your situation:

### A. Deployment Issues
- [ ] Can't find the Apps Script editor
- [ ] Can't paste the code
- [ ] Can't save the code
- [ ] Can't deploy as Web App
- [ ] Get permission errors

### B. Runtime Issues  
- [ ] Web app shows error page
- [ ] Web app is blank
- [ ] Shows "Factors=0 • Questionnaire unavailable"
- [ ] Start button is disabled/frozen
- [ ] Console shows errors

### C. Data Issues
- [ ] Sheets not created
- [ ] Sheets are empty
- [ ] Can't run initialization functions
- [ ] Functions return errors

### D. Other
- [ ] Something else (describe below)

---

## 🔍 STEP 2: Run These Checks

### Check 1: Verify You're Using the Fixed Files

**Open your Code.gs in Apps Script and search for this text:**
```javascript
function cpos_hasSheetData_(sheetName) {
```

✅ **If FOUND** → You're using the FIXED code (correct!)  
❌ **If NOT FOUND** → You're using OLD code (wrong!)

**Fix:** Copy `CPOS_backend_FIXED_120226.gs` again to Code.gs

---

### Check 2: Verify Your Spreadsheet ID

**Open Code.gs and look for line ~89:**
```javascript
const CPOS_SS_ID = 'YOUR_ID_HERE';
```

✅ **Should be:** `'1f3rcNISHiDHChnboN7eMrjSef0LGuGjbwLbUejk5_QE'`  
❌ **Should NOT be:** `'PASTE_YOUR_SPREADSHEET_ID_HERE'`

**Fix:** Replace with your actual spreadsheet ID

---

### Check 3: Verify Container-Bound Script

**In Apps Script editor, check the title bar:**

✅ **Should show:** Your spreadsheet name (e.g., "CPOS Data - Code.gs")  
❌ **Should NOT show:** Just "Code.gs" or "Untitled project"

**If it's standalone:**
1. Close the script editor
2. Open your Google Spreadsheet
3. Go to **Extensions > Apps Script** (from the spreadsheet!)
4. Copy the fixed code there

---

### Check 4: Run Manual Initialization

**In Apps Script editor:**

1. Select function: `INIT_ALL_CPOS_TABLES`
2. Click Run (▶️)
3. Grant permissions if asked
4. Check logs: **View > Logs**

**Expected in logs:**
```
✅ Created CPOS_Lite_Bounds sheet
✅ Created CPOS_Lite_Desirability sheet
✅ Created CPOS_Lite_Weights sheet
✅ All CPOS tables initialized successfully!
```

**If you see errors in logs, copy the error message** and I'll help you fix it.

---

### Check 5: Verify Sheets Were Created

**Open your Google Spreadsheet and check for these 8 sheets:**

1. ✅ CPOS_Lite_Bounds
2. ✅ CPOS_Lite_Desirability
3. ✅ CPOS_Lite_Weights
4. ✅ CPOS_Q_Bank
5. ✅ CPOS_Q_Options
6. ✅ CPOS_Q_Derivation_Rules
7. ✅ CPOS_Q_Routing_Rules
8. ✅ CPOS_Q_Signal_to_LiteFactor_Map

**Each sheet should have:**
- Row 1: Headers
- Rows 2-4: Sample data (3 rows)

**If sheets are missing or empty:**
1. Go to Apps Script
2. Run `INIT_ALL_CPOS_TABLES()`
3. Check logs for errors

---

### Check 6: Test the Web App

**After deploying:**

1. Open the web app URL in browser
2. Press F12 to open console
3. Look for these messages:

**✅ SUCCESS - Should see:**
```
[CPOS] buildIndexes {boundsRows: 3, desirRows: 3, weightRows: 3}
questionnaireReady: true, bankSize: 3
```

**❌ FAILURE - If you see:**
```
boundsRows: 0, desirRows: 0, weightRows: 0
getCPOSQuestionnaireConfig() raw = null
```

**This means initialization didn't run or failed.**

---

## 🚑 COMMON FIXES

### Fix 1: "No active spreadsheet" Error

**Cause:** Script is standalone instead of container-bound

**Solution:**
1. Close the standalone Apps Script
2. Open your Google Spreadsheet
3. Click **Extensions > Apps Script**
4. Copy the code there
5. Deploy from that editor

---

### Fix 2: "Invalid spreadsheet ID" Error

**Cause:** Wrong ID or still using placeholder

**Solution:**
1. Open your spreadsheet
2. Copy the ID from URL (between `/d/` and `/edit`)
3. In Code.gs, update line 89:
   ```javascript
   const CPOS_SS_ID = 'YOUR_ACTUAL_ID_HERE';
   ```

---

### Fix 3: Sheets Created But Empty

**Cause:** Initialization ran but didn't add data

**Solution:**
1. Delete all CPOS sheets from spreadsheet
2. In Apps Script, run `INIT_ALL_CPOS_TABLES()`
3. Check logs for errors
4. Verify sheets now have data

---

### Fix 4: Permission Denied

**Cause:** First-time authorization needed

**Solution:**
1. When running function, click "Review Permissions"
2. Choose your Google account
3. Click "Advanced"
4. Click "Go to [Your Project]"
5. Click "Allow"
6. Try running again

---

### Fix 5: Web App Shows Blank Page

**Cause:** Wrong HTML file or deployment issue

**Solution:**
1. Check Index.html exists in Apps Script
2. Verify it contains HTML code (starts with `<!doctype html>`)
3. Create new deployment:
   - Deploy > New deployment
   - Type: Web app
   - Execute as: Me
   - Who has access: Anyone
4. Use the NEW web app URL

---

### Fix 6: Still Shows "Factors=0"

**Cause:** Using old code or initialization didn't complete

**Solution:**
1. Verify using `CPOS_backend_FIXED_120226.gs` (check for `cpos_hasSheetData_` function)
2. Run `INIT_ALL_CPOS_TABLES()` manually
3. Check all 8 sheets have data
4. Clear browser cache
5. Open web app in incognito mode
6. Check console for errors

---

## 📞 STEP 3: Report the Issue

If none of the above fixes work, please provide:

### Information Needed:

1. **Which symptom?** (A, B, C, or D from Step 1)

2. **Apps Script Logs** (View > Logs):
   ```
   Copy and paste any error messages here
   ```

3. **Browser Console Logs** (F12 > Console):
   ```
   Copy and paste console output here
   ```

4. **Verification Results:**
   - [ ] Check 1: Using fixed code? (YES/NO)
   - [ ] Check 2: Correct spreadsheet ID? (YES/NO)
   - [ ] Check 3: Container-bound script? (YES/NO)
   - [ ] Check 4: Manual init ran? (YES/NO/ERROR)
   - [ ] Check 5: Sheets created with data? (YES/NO)
   - [ ] Check 6: Web app test result? (SUCCESS/FAILURE)

5. **Screenshot:** 
   - Screenshot of your web app showing the issue
   - Screenshot of Apps Script logs if there are errors

---

## 🎯 QUICK FIX CHECKLIST

Try these in order:

1. ✅ **Use container-bound script** (Extensions > Apps Script from spreadsheet)
2. ✅ **Copy CPOS_backend_FIXED_120226.gs** → Code.gs
3. ✅ **Copy CPOS_frontend_FIXED_120226.html** → Index.html
4. ✅ **Save the project**
5. ✅ **Run INIT_ALL_CPOS_TABLES()** manually
6. ✅ **Check logs** for success/errors
7. ✅ **Verify 8 sheets** have data in spreadsheet
8. ✅ **Deploy** as Web App (new deployment)
9. ✅ **Test** in incognito browser window
10. ✅ **Check console** (F12) for errors

---

## 📚 Reference Documents

- `DEPLOY_FIXED_FILES.md` - Complete deployment guide
- `HOW_TO_FIND_SPREADSHEET_ID.md` - Find your spreadsheet ID
- `URGENT_USE_CORRECT_FILES.md` - Which files to use
- `CRITICAL_FIX_SUMMARY.md` - What was fixed
- `DEPLOYMENT_SUMMARY.md` - Overview of deployment

---

## 🔧 Advanced Troubleshooting

### Check Apps Script Execution Log

1. In Apps Script: **View > Executions**
2. Look at recent runs
3. Click on failed executions to see errors

### Check Spreadsheet Permissions

1. Spreadsheet > Share
2. Make sure your account has Editor access
3. Script needs permission to modify sheets

### Force Refresh Everything

1. Clear browser cache
2. Delete old deployment
3. Create completely new deployment
4. Use new URL
5. Test in incognito window

### Verify Code Is Saved

1. In Apps Script, make changes
2. Press Ctrl+S (or Cmd+S)
3. Look for "Saved" message at top
4. Close and reopen to verify changes persist

---

## ✅ Success Indicators

You'll know it's working when:

1. **In Spreadsheet:**
   - 8 sheets exist
   - Each sheet has headers + 3 data rows

2. **In Apps Script Logs:**
   - "Auto-initialization successful"
   - No error messages

3. **In Web App:**
   - Status: "Ready • Factors=3"
   - Start button enabled
   - No error messages

4. **In Browser Console:**
   - `boundsRows: 3, desirRows: 3, weightRows: 3`
   - `bankSize: 3`
   - `questionnaireReady: true`

---

**Need more help? Run through Steps 1-3 above and provide the specific information requested.** 🚀
