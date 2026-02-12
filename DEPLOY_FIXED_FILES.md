# 🚀 CPOS Fixed Code Files - Deployment Guide

## ✅ USE THESE FIXED FILES

Deploy these files to fix the "Factors=0 • Questionnaire unavailable" issue:

### Backend (Code.gs)
📄 **File:** `CPOS_backend_FIXED_120226.gs`
- ✅ Has all critical bug fixes
- ✅ Validates spreadsheet ID (rejects placeholder)
- ✅ Detects empty sheets (not just existence)
- ✅ Auto-initializes missing or empty data

### Frontend (Index.html)
📄 **File:** `CPOS_frontend_FIXED_120226.html`
- ✅ Compatible with fixed backend
- ✅ Proper error handling
- ✅ Clear status messages

## 🚀 Quick Deployment (5 Minutes)

### Step 1: Open Your Spreadsheet
1. Open your Google Spreadsheet in browser
2. The one with your data (ID: `1f3rcNISHiDHChnboN7eMrjSef0LGuGjbwLbUejk5_QE`)

### Step 2: Open Apps Script
1. Click **Extensions > Apps Script**
2. This opens the script editor attached to your spreadsheet

### Step 3: Deploy Backend
1. In the script editor, find/open **Code.gs**
2. **DELETE** all existing code
3. **COPY** the entire content of `CPOS_backend_FIXED_120226.gs`
4. **PASTE** it into Code.gs
5. **VERIFY** your spreadsheet ID is on line 89 (should already be there)
6. Save (Ctrl+S or Cmd+S)

### Step 4: Deploy Frontend
1. In the script editor, find/create **Index.html**
2. **DELETE** all existing content
3. **COPY** the entire content of `CPOS_frontend_FIXED_120226.html`
4. **PASTE** it into Index.html
5. Save (Ctrl+S or Cmd+S)

### Step 5: Deploy Web App
1. Click **Deploy > New deployment** (or manage deployments)
2. If creating new:
   - Type: **Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
3. Click **Deploy**
4. Copy the web app URL

### Step 6: Test
1. Open the web app URL in browser
2. You should immediately see:
   - ✅ Status: "Ready • Factors=3" (not 0!)
   - ✅ Questionnaire section enabled
   - ✅ Start button clickable
   - ✅ Console shows: `boundsRows: 3, desirRows: 3, weightRows: 3`

## ❌ DO NOT USE THESE OLD FILES

These files are from the main branch and have critical bugs:

- ❌ `CPOS_backend_120226` (old, no fixes)
- ❌ `CPOS_frontend_120226` (old version)
- ❌ `CPOS_100226_backend` (working name, use FIXED version instead)
- ❌ `CPOS_100226_frontend` (working name, use FIXED version instead)

## 📋 File Comparison

| File | Status | Use? |
|------|--------|------|
| `CPOS_backend_FIXED_120226.gs` | ✅ All fixes applied | **YES - USE THIS** |
| `CPOS_frontend_FIXED_120226.html` | ✅ All fixes applied | **YES - USE THIS** |
| `CPOS_backend_120226` | ❌ Old, no fixes | NO |
| `CPOS_frontend_120226` | ❌ Old version | NO |

## 🔍 How to Verify You're Using the Right File

After deploying, check if your Code.gs contains this function (around line 90):

```javascript
function cpos_hasSheetData_(sheetName) {
  try {
    const ss = cpos_getSS_();
    const sheet = ss.getSheetByName(sheetName);
    return sheet && sheet.getLastRow() > 1;
  } catch (e) {
    return false;
  }
}
```

✅ **If YES** → You're using the FIXED file (correct!)  
❌ **If NO** → You're using the OLD file (wrong - deploy the FIXED version)

## 🐛 What Was Fixed

### Bug 1: Spreadsheet ID Placeholder
**OLD CODE** (allowed placeholder to pass):
```javascript
if (CPOS_SS_ID && String(CPOS_SS_ID).trim()) {
  return SpreadsheetApp.openById(CPOS_SS_ID);
}
```

**FIXED CODE** (rejects placeholder):
```javascript
const hasValidId = CPOS_SS_ID && 
                   String(CPOS_SS_ID).trim() && 
                   CPOS_SS_ID !== 'PASTE_YOUR_SPREADSHEET_ID_HERE';
if (hasValidId) {
  return SpreadsheetApp.openById(String(CPOS_SS_ID).trim());
}
```

### Bug 2: Empty Sheet Detection
**OLD CODE** (only checked existence):
```javascript
const hasBounds = ss.getSheetByName('CPOS_Lite_Bounds') !== null;
```

**FIXED CODE** (checks for data):
```javascript
const boundsHasData = cpos_hasSheetData_('CPOS_Lite_Bounds');
// Returns true only if sheet exists AND has data rows
```

## 💡 Need Help?

Check these documents in this repository:
- `HOW_TO_FIND_SPREADSHEET_ID.md` - How to extract your spreadsheet ID
- `URGENT_USE_CORRECT_FILES.md` - Detailed explanation of file differences
- `URGENT_FIX_SPREADSHEET_ID.md` - Complete fix documentation

## ✅ Success Checklist

After deployment, verify:
- [ ] Status shows "Ready • Factors=3" (not 0)
- [ ] Browser console shows `boundsRows: 3, desirRows: 3, weightRows: 3`
- [ ] Start button is enabled and clickable
- [ ] Questionnaire loads when you click Start
- [ ] No error messages in console
- [ ] All 8 sheets have data in your spreadsheet

---

**Bottom Line:** Use `CPOS_backend_FIXED_120226.gs` and `CPOS_frontend_FIXED_120226.html` for guaranteed working system! 🎯
