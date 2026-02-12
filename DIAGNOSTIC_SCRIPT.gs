/**
 * 🔍 DIAGNOSTIC SCRIPT - Run this to identify your issue
 * 
 * HOW TO USE:
 * 1. Copy this entire file
 * 2. In Apps Script, create a new script file (File > New > Script file)
 * 3. Name it "Diagnostics"
 * 4. Paste this code
 * 5. Run the function: DIAGNOSE_CPOS_ISSUE()
 * 6. Check the logs (View > Logs)
 * 7. Copy the diagnostic report
 * 
 * This will tell you exactly what's wrong!
 */

function DIAGNOSE_CPOS_ISSUE() {
  Logger.log('═══════════════════════════════════════════════════════');
  Logger.log('🔍 CPOS DIAGNOSTIC REPORT');
  Logger.log('═══════════════════════════════════════════════════════');
  Logger.log('');
  
  const issues = [];
  const warnings = [];
  const success = [];
  
  // Check 1: Spreadsheet Access
  Logger.log('📊 CHECK 1: Spreadsheet Access');
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (ss) {
      success.push('✅ Active spreadsheet found');
      Logger.log('✅ Active spreadsheet: ' + ss.getName());
      Logger.log('   ID: ' + ss.getId());
    } else {
      issues.push('❌ No active spreadsheet - use container-bound script');
      Logger.log('❌ No active spreadsheet found');
    }
  } catch (e) {
    issues.push('❌ Cannot access spreadsheet: ' + e.message);
    Logger.log('❌ Error accessing spreadsheet: ' + e.message);
  }
  Logger.log('');
  
  // Check 2: Required Functions
  Logger.log('🔧 CHECK 2: Required Functions');
  const requiredFunctions = [
    'cpos_hasSheetData_',
    'getCPOSLiteTables',
    'getCPOSQuestionnaireConfig',
    'INIT_LITE_TABLES',
    'INIT_QUESTIONNAIRE_SHEETS',
    'INIT_ALL_CPOS_TABLES'
  ];
  
  requiredFunctions.forEach(funcName => {
    try {
      const func = eval(funcName);
      if (typeof func === 'function') {
        success.push('✅ Function exists: ' + funcName);
        Logger.log('✅ ' + funcName + ' - exists');
      } else {
        issues.push('❌ Not a function: ' + funcName);
        Logger.log('❌ ' + funcName + ' - not a function');
      }
    } catch (e) {
      issues.push('❌ Missing function: ' + funcName);
      Logger.log('❌ ' + funcName + ' - NOT FOUND (you are using OLD code!)');
    }
  });
  Logger.log('');
  
  // Check 3: Sheets Exist
  Logger.log('📄 CHECK 3: Required Sheets');
  const requiredSheets = [
    'CPOS_Lite_Bounds',
    'CPOS_Lite_Desirability',
    'CPOS_Lite_Weights',
    'CPOS_Q_Bank',
    'CPOS_Q_Options',
    'CPOS_Q_Derivation_Rules',
    'CPOS_Q_Routing_Rules',
    'CPOS_Q_Signal_to_LiteFactor_Map'
  ];
  
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const existingSheets = ss.getSheets().map(s => s.getName());
    
    requiredSheets.forEach(sheetName => {
      if (existingSheets.indexOf(sheetName) >= 0) {
        success.push('✅ Sheet exists: ' + sheetName);
        Logger.log('✅ ' + sheetName + ' - exists');
      } else {
        warnings.push('⚠️  Sheet missing: ' + sheetName);
        Logger.log('⚠️  ' + sheetName + ' - MISSING (run INIT_ALL_CPOS_TABLES)');
      }
    });
  } catch (e) {
    issues.push('❌ Cannot check sheets: ' + e.message);
    Logger.log('❌ Error checking sheets: ' + e.message);
  }
  Logger.log('');
  
  // Check 4: Sheets Have Data
  Logger.log('📊 CHECK 4: Sheet Data');
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    
    requiredSheets.forEach(sheetName => {
      const sheet = ss.getSheetByName(sheetName);
      if (sheet) {
        const lastRow = sheet.getLastRow();
        if (lastRow > 1) {
          success.push('✅ ' + sheetName + ' has data (' + (lastRow - 1) + ' rows)');
          Logger.log('✅ ' + sheetName + ' - ' + (lastRow - 1) + ' data rows');
        } else {
          warnings.push('⚠️  ' + sheetName + ' is EMPTY (only headers or blank)');
          Logger.log('⚠️  ' + sheetName + ' - EMPTY (run INIT_ALL_CPOS_TABLES)');
        }
      }
    });
  } catch (e) {
    issues.push('❌ Cannot check sheet data: ' + e.message);
    Logger.log('❌ Error checking sheet data: ' + e.message);
  }
  Logger.log('');
  
  // Check 5: Test Helper Function
  Logger.log('🧪 CHECK 5: Data Detection Function');
  try {
    if (typeof cpos_hasSheetData_ === 'function') {
      const testResult = cpos_hasSheetData_('CPOS_Lite_Bounds');
      if (testResult === true) {
        success.push('✅ Data detection working - Bounds has data');
        Logger.log('✅ cpos_hasSheetData_() working - Bounds has data');
      } else {
        warnings.push('⚠️  Data detection says Bounds is empty');
        Logger.log('⚠️  cpos_hasSheetData_() says Bounds is empty');
      }
    } else {
      issues.push('❌ cpos_hasSheetData_() not found - using OLD CODE!');
      Logger.log('❌ cpos_hasSheetData_() NOT FOUND - YOU ARE USING OLD CODE!');
    }
  } catch (e) {
    issues.push('❌ Error testing helper function: ' + e.message);
    Logger.log('❌ Error testing cpos_hasSheetData_(): ' + e.message);
  }
  Logger.log('');
  
  // Check 6: Test API Functions
  Logger.log('🌐 CHECK 6: API Functions');
  try {
    const liteResult = getCPOSLiteTables();
    if (liteResult && liteResult.ok) {
      success.push('✅ getCPOSLiteTables() returned ok: true');
      Logger.log('✅ getCPOSLiteTables() - ok: true');
      Logger.log('   Bounds rows: ' + (liteResult.bounds || []).length);
      Logger.log('   Desirability rows: ' + (liteResult.desirability || []).length);
      Logger.log('   Weights rows: ' + (liteResult.weights || []).length);
    } else {
      warnings.push('⚠️  getCPOSLiteTables() returned ok: false');
      Logger.log('⚠️  getCPOSLiteTables() - ok: false or null');
    }
  } catch (e) {
    issues.push('❌ getCPOSLiteTables() error: ' + e.message);
    Logger.log('❌ getCPOSLiteTables() ERROR: ' + e.message);
  }
  
  try {
    const qResult = getCPOSQuestionnaireConfig();
    if (qResult && qResult.ok) {
      success.push('✅ getCPOSQuestionnaireConfig() returned ok: true');
      Logger.log('✅ getCPOSQuestionnaireConfig() - ok: true');
      Logger.log('   Bank rows: ' + (qResult.bank || []).length);
      Logger.log('   Options rows: ' + (qResult.options || []).length);
    } else {
      warnings.push('⚠️  getCPOSQuestionnaireConfig() returned ok: false');
      Logger.log('⚠️  getCPOSQuestionnaireConfig() - ok: false or null');
    }
  } catch (e) {
    issues.push('❌ getCPOSQuestionnaireConfig() error: ' + e.message);
    Logger.log('❌ getCPOSQuestionnaireConfig() ERROR: ' + e.message);
  }
  Logger.log('');
  
  // SUMMARY
  Logger.log('═══════════════════════════════════════════════════════');
  Logger.log('📋 DIAGNOSTIC SUMMARY');
  Logger.log('═══════════════════════════════════════════════════════');
  Logger.log('');
  Logger.log('✅ Successes: ' + success.length);
  Logger.log('⚠️  Warnings: ' + warnings.length);
  Logger.log('❌ Critical Issues: ' + issues.length);
  Logger.log('');
  
  if (issues.length > 0) {
    Logger.log('❌ CRITICAL ISSUES FOUND:');
    issues.forEach(issue => Logger.log('   ' + issue));
    Logger.log('');
  }
  
  if (warnings.length > 0) {
    Logger.log('⚠️  WARNINGS:');
    warnings.forEach(warning => Logger.log('   ' + warning));
    Logger.log('');
  }
  
  // RECOMMENDATIONS
  Logger.log('═══════════════════════════════════════════════════════');
  Logger.log('💡 RECOMMENDATIONS');
  Logger.log('═══════════════════════════════════════════════════════');
  Logger.log('');
  
  if (issues.indexOf('❌ cpos_hasSheetData_() not found - using OLD CODE!') >= 0 ||
      issues.indexOf('❌ Missing function: cpos_hasSheetData_') >= 0) {
    Logger.log('🔥 YOU ARE USING OLD CODE WITHOUT FIXES!');
    Logger.log('');
    Logger.log('ACTION REQUIRED:');
    Logger.log('1. Copy CPOS_backend_FIXED_120226.gs');
    Logger.log('2. Paste into Code.gs (replace all content)');
    Logger.log('3. Save (Ctrl+S)');
    Logger.log('4. Run this diagnostic again');
    Logger.log('');
  }
  
  const missingSheets = warnings.filter(w => w.includes('Sheet missing'));
  const emptySheets = warnings.filter(w => w.includes('is EMPTY'));
  
  if (missingSheets.length > 0 || emptySheets.length > 0) {
    Logger.log('📊 SHEETS NEED INITIALIZATION');
    Logger.log('');
    Logger.log('ACTION REQUIRED:');
    Logger.log('1. Run the function: INIT_ALL_CPOS_TABLES()');
    Logger.log('2. Check logs for success messages');
    Logger.log('3. Verify sheets now have data');
    Logger.log('4. Run this diagnostic again');
    Logger.log('');
  }
  
  if (issues.length === 0 && warnings.length === 0) {
    Logger.log('🎉 ALL CHECKS PASSED!');
    Logger.log('');
    Logger.log('Your system is properly configured.');
    Logger.log('If you still have issues:');
    Logger.log('1. Deploy as Web App (Deploy > New deployment)');
    Logger.log('2. Open web app URL in browser');
    Logger.log('3. Press F12 to open console');
    Logger.log('4. Check for error messages');
    Logger.log('');
  }
  
  Logger.log('═══════════════════════════════════════════════════════');
  Logger.log('END OF DIAGNOSTIC REPORT');
  Logger.log('═══════════════════════════════════════════════════════');
}
