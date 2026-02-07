/***********************
 * CP-OS v1.0 Backend
 * - Reads CPOS_Classes, CPOS_Rules
 * - Evaluates rules (Option A: human IF parsing)
 * - Saves assessment to CPOS_Assessments
 ***********************/

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('CP-OS v1.1 DSS')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function cpos_upsertDraft(p) {
  return cpos_upsertDraft_(p);
}


/** ---------- Utilities ---------- */

function cpos_getSheet_(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(name);
  if (!sh) throw new Error(`Missing sheet: ${name}`);
  return sh;
}

function cpos_tryGetSheet_(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(name);
  return sh || null;
}



function cpos_getTable_(sheetName) {
  const sh = cpos_getSheet_(sheetName);
  const range = sh.getDataRange();
  const values = range.getValues();
  if (values.length < 2) return { headers: [], rows: [] };

  const headers = values[0].map(h => String(h || '').trim());
  const rows = [];
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const obj = {};
    let isEmpty = true;
    headers.forEach((h, idx) => {
      const v = row[idx];
      if (v !== '' && v !== null && v !== undefined) isEmpty = false;
      obj[h] = v;
    });
    if (!isEmpty) rows.push(obj);
  }
  return { headers, rows };
}

function cpos_toBool_(v, defaultValue) {
  // Default behavior: blank/undefined => TRUE (enabled)
  if (v === '' || v === null || v === undefined) {
    return (defaultValue === undefined) ? true : !!defaultValue;
  }
  if (typeof v === 'boolean') return v;

  const s = String(v).trim().toLowerCase();
  if (s === 'true' || s === 'yes' || s === '1') return true;
  if (s === 'false' || s === 'no' || s === '0') return false;

  // Anything else: fall back to default (TRUE by default)
  return (defaultValue === undefined) ? true : !!defaultValue;
}


function cpos_nowISO_() {
  return new Date().toISOString();
}


const CPOS_ORDER_VERSION = 'v1';

const CPOS_PATHWAYS = ['RP-SOC', 'AWD-CH₄', 'BIOCHAR', 'ERW'];

const CPOS_PATHWAY_ORDERS = {
  // locked by you
  'AWD-CH₄': [
    'Crop Type',
    'Water Management Intensity',
    'Drainage Class',
    'Operational / Irrigation Control',
    'Temperature Regime',
    'Soil Texture',
    'Other'
  ],
  // locked by you
  'ERW': [
    'Mineral Reactivity',
    'Particle Size / Fineness',
    'Rainfall Pattern',
    'Drainage Class',
    'Soil pH',
    'Crop Type',
    'Bulk Density / Structure',
    'Other'
  ],
  // added now
  'BIOCHAR': [
    'Soil Texture',
    'Rainfall Pattern',
    'Soil pH',
    'Baseline SOC',
    'Soil Mineralogy',
    'Bulk Density / Structure',
    'Nutrient Availability / Stoichiometry',
    'Residue Quantity & Quality',
    'Temperature Regime',
    'Drainage Class',
    'Crop Type',
    'Water Management Intensity',
    'Operational / Irrigation Control',
    'Other'
  ],
  // added now
  'RP-SOC': [
    'Crop Type',
    'Residue Quantity & Quality',
    'Baseline SOC',
    'Soil Mineralogy',
    'Soil Texture',
    'Nutrient Availability / Stoichiometry',
    'Bulk Density / Structure',
    'Drainage Class',
    'Rainfall Pattern',
    'Temperature Regime',
    'Water Management Intensity',
    'Operational / Irrigation Control',
    'Other'
  ]
};



/** ---------- Public API ---------- */

function cpos_rulesSheetIsCache_() {
  const sh = cpos_getSheet_('CPOS_Rules');
  const lastCol = sh.getLastColumn();
  if (lastCol < 1) return false;

  const headers = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h || '').trim());

  // Cache header signature
  const looksCache =
    headers.includes('Combo_Key') &&
    headers.includes('Pathway_Key') &&
    headers.includes('Final_Text') &&
    headers.includes('Aspect_Selections_JSON');

  // Rule-engine signature (old v1)
  const looksEngine =
    headers.includes('IF') &&
    headers.includes('Applies_To');

  // If it looks like cache, treat as cache (skip reading rows as rules)
  if (looksCache && !looksEngine) return true;

  return false;
}



/**
 * Returns:
 * - classes: grouped options for dropdowns + row map for pathway text
 * - rules: enabled rules (as raw table rows)
 */
function getCPOSData(opts) {
  opts = opts || {};

  // By default keep backward compatibility (v1 callers).
  // v2 will call getCPOSData({ includeRules:false }).
  const includeRules = Object.prototype.hasOwnProperty.call(opts, 'includeRules')
    ? (opts.includeRules === true)
    : true;

  const classesTbl = cpos_getTable_('CPOS_Classes');

  // ✅ Classes
  const classesRows = (classesTbl.rows || [])
    .filter(r => cpos_toBool_(r.Is_Enabled) !== false);

  // ✅ Rules (v1 legacy) - only load if explicitly requested AND CPOS_Rules looks like a rules sheet
  let rulesRows = [];
  if (includeRules) {
    const shRules = cpos_tryGetSheet_('CPOS_Rules');
    if (shRules) {
      const lastCol = shRules.getLastColumn();
      if (lastCol >= 1) {
        const headers = shRules.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h || '').trim());

        // Cache signature (v2)
        const looksLikeCache = headers.includes('Combo_Key') && headers.includes('Final_Text');

        // Rules signature (v1)
        const looksLikeRules = headers.includes('IF') && headers.includes('Applies_To');

        if (looksLikeRules && !looksLikeCache) {
          const tbl = cpos_getTable_('CPOS_Rules');
          rulesRows = (tbl.rows || []).filter(r => cpos_toBool_(r.Is_Enabled) !== false);
        } else {
          rulesRows = [];
        }
      }
    }
  }

  // Build dropdown options: Aspect -> [Class...], also capture category
  const aspectsMap = {}; // { Aspect: { category, classes:[], rowsByClass:{} } }

  classesRows.forEach(r => {
    const aspect = String(r.Aspect || '').trim();
    const category = String(r.Aspect_Category || '').trim();
    const cls = String(r.Class || '').trim();
    if (!aspect || !cls) return;

    if (!aspectsMap[aspect]) {
      aspectsMap[aspect] = { category, classes: [], rowsByClass: {} };
    }

    if (!aspectsMap[aspect].classes.includes(cls)) {
      aspectsMap[aspect].classes.push(cls);
    }

    aspectsMap[aspect].rowsByClass[cls] = {
      RP_SOC_Text: String(r.RP_SOC_Text || ''),
      AWD_CH4_Text: String(r.AWD_CH4_Text || ''),
      BIOCHAR_Text: String(r.BIOCHAR_Text || ''),
      ERW_Text: String(r.ERW_Text || ''),
      MRV_Variables: String(r.MRV_Variables || '')
    };
  });

  // Sort classes alphabetically for UI cleanliness
  Object.keys(aspectsMap).forEach(a => {
    aspectsMap[a].classes.sort((x, y) => String(x).localeCompare(String(y)));
  });

  return {
    ok: true,
    aspectsMap,
    rules: rulesRows
  };
}



/**
 * Evaluate CP-OS rules using current selections.
 * selections: { "<Aspect>": "<Class>", ... }
 *
 * Returns per pathway:
 * - eligibility: YES/NO/CONDITIONAL
 * - priority: HIGH/MEDIUM/LOW (derived from impacts)
 * - mrv_tier: LIGHT/STANDARD/HIGH (derived from impacts)
 * - reasons: list of reasons
 * - flags: list of flags
 */
function evaluateCPOS_v2(selections, opts) {
  if (!selections || typeof selections !== 'object') {
    throw new Error('evaluateCPOS_v2: selections missing');
  }

  opts = opts || {};
  const noCache = opts.noCache === true;         // preview mode
  const debug = opts.debug === true;

  // Touch behavior:
  // - normal mode (noCache=false): touch unless explicitly disabled (touchCache:false)
  // - preview mode (noCache=true): touch ONLY if explicitly enabled (touchCache:true)
  const doTouch =
    (!noCache && opts.touchCache !== false) ||
    (noCache && opts.touchCache === true);

  // Ensure CPOS_Rules is in cache header mode
  cpos_assertRulesCacheHeader_();

  // v2 only needs Classes (rules are legacy v1)
  const data = getCPOSData({ includeRules: false });
  const aspectsMap = data.aspectsMap || {};

  // Prepare result skeleton
  const results = {};
  (CPOS_PATHWAYS || []).forEach(p => {
    results[p] = {
      eligibility: 'YES',
      priority: 'MEDIUM',
      mrv_tier: 'STANDARD',
      reasons: [],
      flags: [],
      final_text: '',
      mrv_variables: []
    };
  });


  // -------------------------
  // Cache index (cheap read)
  //   - header row once
  //   - Combo_Key column only (NOT full DataRange)
  // -------------------------
  const cache = (function buildCacheIndex_() {
    const sh = cpos_getSheet_('CPOS_Rules');

    const lastRow = sh.getLastRow();
    const lastCol = sh.getLastColumn();

    if (lastRow < 1 || lastCol < 1) {
      throw new Error('CPOS_Rules: sheet is empty / missing header row.');
    }

    // Header row
    const headers = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h || '').trim());
    const col = {};
    headers.forEach((h, i) => { if (h) col[h] = i; });

    const idxCombo = col['Combo_Key'];
    if (idxCombo === undefined) throw new Error('CPOS_Rules cache missing header: Combo_Key');

    // Read only Combo_Key column values (rows 2..lastRow)
    const keyToRow = new Map(); // Combo_Key -> row number (1-based)
    if (lastRow >= 2) {
      const keys = sh.getRange(2, idxCombo + 1, lastRow - 1, 1).getValues();
      for (let i = 0; i < keys.length; i++) {
        const key = String(keys[i][0] || '').trim();
        if (!key) continue;
        const rowNum = i + 2; // because keys start at row 2
        if (!keyToRow.has(key)) keyToRow.set(key, rowNum);
      }
    }

    return { sh, headers, col, keyToRow, lastRow, lastCol };
  })();


  // Helper: pull a minimal cached row object for cpos_cachedRow_toResult_()
  // Helper: read a single cached row (only when key matches)
  function cacheGetRowObj_(comboKey) {
    const rowNum = cache.keyToRow.get(comboKey);
    if (!rowNum) return null;

    const rowArr = cache.sh.getRange(rowNum, 1, 1, cache.lastCol).getValues()[0];
    const col = cache.col;

    const obj = {
      Combo_Key: comboKey,
      Is_Enabled: (col.Is_Enabled !== undefined) ? rowArr[col.Is_Enabled] : true,

      Eligibility_Impact: (col.Eligibility_Impact !== undefined) ? rowArr[col.Eligibility_Impact] : '',
      Priority_Impact: (col.Priority_Impact !== undefined) ? rowArr[col.Priority_Impact] : '',
      MRV_Tier_Impact: (col.MRV_Tier_Impact !== undefined) ? rowArr[col.MRV_Tier_Impact] : '',

      Risk_Flags_JSON: (col.Risk_Flags_JSON !== undefined) ? rowArr[col.Risk_Flags_JSON] : '[]',
      MRV_Variables_JSON: (col.MRV_Variables_JSON !== undefined) ? rowArr[col.MRV_Variables_JSON] : '[]',

      Invalid_Reason: (col.Invalid_Reason !== undefined) ? rowArr[col.Invalid_Reason] : '',
      Final_Text: (col.Final_Text !== undefined) ? rowArr[col.Final_Text] : ''
    };

    // Touch columns (present in your header)
    if (col.Last_Used_At !== undefined) obj.Last_Used_At = rowArr[col.Last_Used_At];
    if (col.Use_Count !== undefined) obj.Use_Count = rowArr[col.Use_Count];

    obj.__row = rowNum;
    return obj;
  }


  // Batch-touch rows (contiguous block writes)
  function cacheTouchRowsBatch_(rowNums) {
    if (!doTouch) return 0;

    const idxLast = (cache.col.Last_Used_At !== undefined) ? cache.col.Last_Used_At : -1;
    const idxCount = (cache.col.Use_Count !== undefined) ? cache.col.Use_Count : -1;

    if (idxLast < 0 && idxCount < 0) return 0;

    const uniq = [...new Set((rowNums || [])
      .map(n => Number(n))
      .filter(n => Number.isFinite(n) && n >= 2))]
      .sort((a, b) => a - b);

    if (!uniq.length) return 0;

    const now = cpos_nowISO_();

    // Group into contiguous blocks
    const blocks = [];
    let start = uniq[0], prev = uniq[0];
    for (let i = 1; i < uniq.length; i++) {
      const r = uniq[i];
      if (r === prev + 1) { prev = r; continue; }
      blocks.push([start, prev]);
      start = r; prev = r;
    }
    blocks.push([start, prev]);

    const adjacent = (idxLast >= 0 && idxCount >= 0 && idxCount === idxLast + 1);

    blocks.forEach(([a, b]) => {
      const h = b - a + 1;

      if (adjacent) {
        // One 2-column write: [Last_Used_At, Use_Count]
        const out = [];
        for (let r = a; r <= b; r++) {
          // read current Use_Count (one cell read per row is avoided)
          // so we fetch current counts in a single batch:
          // We'll read the range once, then increment in-memory, then write back.
        }

        const counts = cache.sh.getRange(a, idxCount + 1, h, 1).getValues();
        const out2 = [];
        for (let i = 0; i < h; i++) {
          const cur = Number(counts[i][0] || 0);
          out2.push([now, cur + 1]);
        }

        cache.sh.getRange(a, idxLast + 1, h, 2).setValues(out2);

      } else {
        // Fallback (non-adjacent columns)
        if (idxLast >= 0) {
          cache.sh.getRange(a, idxLast + 1, h, 1)
            .setValues(Array.from({ length: h }, () => [now]));
        }

        if (idxCount >= 0) {
          const counts = cache.sh.getRange(a, idxCount + 1, h, 1).getValues();
          const out = [];
          for (let i = 0; i < h; i++) {
            const cur = Number(counts[i][0] || 0);
            out.push([cur + 1]);
          }
          cache.sh.getRange(a, idxCount + 1, h, 1).setValues(out);
        }
      }
    });

    return uniq.length;
  }


  // -------------------------
  // Diagnostics
  // -------------------------
  let cacheHits = 0;
  let cacheTouches = 0;
  let cacheUpserts = 0;
  let computed = 0;

  // Collect touched cache rows and apply once
  const rowsToTouch = [];

  // -------------------------
  // Main pathway loop
  // -------------------------
  (CPOS_PATHWAYS || []).forEach(pathway => {
    const ordered = cpos_buildOrderedSelections_(pathway, selections, aspectsMap);
    const comboKey = cpos_buildComboKey_(pathway, CPOS_ORDER_VERSION, ordered);

    // ---------- Cache read (O(1) map) ----------
    const cached = cacheGetRowObj_(comboKey);
    if (cached && cpos_toBool_(cached.Is_Enabled) !== false) {
      cacheHits++;
      if (doTouch && cached.__row) rowsToTouch.push(cached.__row);

      results[pathway] = cpos_cachedRow_toResult_(cached);
      return;
    }

    computed++;

    // ---------- Fail-fast gate ----------
    const gate = cpos_failFastGate_(pathway, ordered, selections);
    if (gate && gate.invalid) {
      const row = cpos_buildCacheRow_({
        comboKey, pathway, ordered,
        invalidReason: gate.reason,
        eligibilityImpact: gate.eligibility || 'NO',
        priorityImpact: 'NONE',
        mrvTierImpact: gate.mrv_tier_impact || 'NONE',
        flags: gate.flags || [],
        finalText: '',
        mrvVars: []
      });

      // write cache only when NOT in noCache mode
      if (!noCache) {
        cpos_rulesCache_upsert_(row);
        cacheUpserts++;
      }

      results[pathway] = cpos_cachedRow_toResult_(row);
      return;
    }

    // ---------- Synthesis + impacts ----------
    const synth = cpos_synthesize_(pathway, ordered, aspectsMap);
    const impacts = cpos_deriveImpacts_(pathway, ordered, selections, synth);

    const row = cpos_buildCacheRow_({
      comboKey, pathway, ordered,
      invalidReason: '',
      eligibilityImpact: impacts.eligibility,
      priorityImpact: impacts.priority_impact,
      mrvTierImpact: impacts.mrv_tier_impact,
      flags: impacts.flags || [],
      finalText: synth.finalText,
      mrvVars: synth.mrvVars
    });

    if (!noCache) {
      cpos_rulesCache_upsert_(row);
      cacheUpserts++;
    }

    results[pathway] = cpos_cachedRow_toResult_(row);
  });

  // ---------- Batch touch once ----------
  if (doTouch && rowsToTouch.length) {
    cacheTouches += cacheTouchRowsBatch_(rowsToTouch);
  }

  const resp = { ok: true, selections, results, meta: { noCache } };

  if (debug) {
    resp.meta = {
      noCache,
      doTouch,
      cacheHits,
      cacheTouches,
      cacheUpserts,
      computed
    };
  }

  return resp;
}


/**
 * Save an assessment to CPOS_Assessments.
 * payload = { clientId, siteId, siteName, lat, lon, cropSystem, state, district, selections, results, notes }
 */
function saveCPOSAssessment(payload) {
  payload = payload || {};
  const sh = cpos_getSheet_('CPOS_Assessments');

  const assessmentId = payload.Assessment_ID || ('CPOS-' + Utilities.getUuid().slice(0, 8).toUpperCase());
  const createdAt = payload.Created_At || cpos_nowISO_();
  const createdBy = payload.Created_By || Session.getActiveUser().getEmail() || 'unknown';

  const row = {
    Assessment_ID: assessmentId,
    Created_At: createdAt,
    Created_By: createdBy,
    Client_ID: payload.Client_ID || payload.clientId || 'Default',
    Site_ID: payload.Site_ID || payload.siteId || '',
    Site_Name: payload.Site_Name || payload.siteName || '',
    Latitude: payload.Latitude || payload.lat || '',
    Longitude: payload.Longitude || payload.lon || '',
    Crop_System: payload.Crop_System || payload.cropSystem || '',
    State: payload.State || payload.state || '',
    District: payload.District || payload.district || '',
    Selected_Classes_JSON: JSON.stringify(payload.selections || {}),
    Pathway_Results_JSON: JSON.stringify(payload.results || {}),
    Top_Reasons_JSON: JSON.stringify(payload.topReasons || {}),
    Risk_Flags_JSON: JSON.stringify(payload.riskFlags || []),
    MRV_Plan_JSON: JSON.stringify(payload.mrvPlan || {}),
    Notes: payload.Notes || payload.notes || ''
  };

  // Append in header order
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(h => String(h || '').trim());
  const out = headers.map(h => row[h] !== undefined ? row[h] : '');
  sh.appendRow(out);

  return { ok: true, Assessment_ID: assessmentId };
}

/** ---------- IF string parser (Option A) ---------- */
/**
 * Supports:
 * - "A = B"
 * - "A ≠ B" or "A != B"
 * - AND / OR (uppercase or lowercase)
 * - Parentheses NOT supported in v1.0 (keep IF simple)
 *
 * selections: { Aspect: Class }
 */
function cpos_evalIfString_(ifStr, selections) {
  if (!ifStr) return true;

  // Split OR first
  const orParts = ifStr.split(/\s+OR\s+/i).map(s => s.trim()).filter(Boolean);
  if (orParts.length > 1) {
    return orParts.some(part => cpos_evalAndGroup_(part, selections));
  }
  return cpos_evalAndGroup_(ifStr, selections);
}

function cpos_evalAndGroup_(expr, selections) {
  const andParts = expr.split(/\s+AND\s+/i).map(s => s.trim()).filter(Boolean);
  return andParts.every(term => cpos_evalTerm_(term, selections));
}

function cpos_evalTerm_(term, selections) {
  if (!term) return false;

  // ---------- Normalizers ----------
  function normKey_(s) {
    return String(s || '')
      .trim()
      .toLowerCase()
      .replace(/\u00A0/g, ' ')
      .replace(/[–—]/g, '-')
      .replace(/\s+/g, ' ')
      .replace(/\s*\/\s*/g, '/')   // internal key normalization
      .trim();
  }

  function normClassLabel_(s) {
    let x = String(s || '').trim();
    x = x.replace(/\u00A0/g, ' ');
    x = x.replace(/[–—]/g, '-');
    x = x.replace(/\s+/g, ' ').trim();
    x = x.replace(/\s*\/\s*/g, ' / '); // display normalization
    x = x.replace(/\s+/g, ' ').trim();
    return x;
  }

  // ---------- Aspect aliases ----------
  const ASPECT_ALIAS = {
    'bulk density/structure': 'Bulk Density / Structure',
    'water mgmt': 'Water Management Intensity',
    'water management': 'Water Management Intensity',
    'operational/irrigation control': 'Operational / Irrigation Control',
    'operational irrigation control': 'Operational / Irrigation Control',
    'nutrients': 'Nutrient Availability / Stoichiometry',
    'microbial biomass/cue': 'Microbial Biomass / CUE',
    'temperature': 'Temperature Regime',
    'rainfall': 'Rainfall Pattern',
    'drainage': 'Drainage Class',
    'residues': 'Residue Quantity & Quality'
  };

  // ---------- Class aliases ----------
  // IMPORTANT: these are SINGLE labels, NOT alternatives
  const CLASS_ALIAS = {
    'low/uncontrolled': 'Low / Uncontrolled',
    'arid/low rainfall': 'Arid / Low rainfall',
    'aerobic/upland': 'Aerobic / upland',
    'humid/high rainfall': 'Humid / High rainfall',
    'humid/high': 'Humid / High rainfall'
  };

  function canonicalAspect_(rawAspect) {
    const k = normKey_(rawAspect);
    return ASPECT_ALIAS[k] || String(rawAspect || '').trim();
  }

  function canonicalClassSingle_(rawClass) {
    const k = normKey_(rawClass);
    const aliased = CLASS_ALIAS[k] || rawClass;
    return normClassLabel_(aliased);
  }

  // Robust selection getter: match by normalized key (handles slash spacing)
  function getSelected_(aspectRaw) {
    const candidates = [
      canonicalAspect_(aspectRaw),
      String(aspectRaw || '').trim()
    ].filter(Boolean);

    const keys = Object.keys(selections || {});
    for (const cand of candidates) {
      const candK = normKey_(cand);
      for (const k of keys) {
        if (normKey_(k) === candK) return String(selections[k]);
        if (normKey_(canonicalAspect_(k)) === candK) return String(selections[k]);
      }
    }
    return '';
  }

  /**
   * Split RHS into alternatives ONLY when it is truly an alternatives expression.
   * Rules:
   * 1) If RHS matches a known single-label alias (e.g., Low/Uncontrolled), treat as single.
   * 2) OR is always alternatives.
   * 3) Slash "/" is alternatives ONLY for known shorthand cases (Clayey/Loamy, Moderate/Well).
   */
  function splitAlternatives_(rhsRaw, aspectRaw) {
    const rhsKey = normKey_(rhsRaw);

    // (1) Known single-label slashes
    if (CLASS_ALIAS[rhsKey]) return [canonicalClassSingle_(rhsRaw)];

    let s = String(rhsRaw || '').trim();

    // (2) OR -> alternatives
    if (/\s+OR\s+/i.test(s)) {
      return s
        .split(/\s+OR\s+/i)
        .map(x => canonicalClassSingle_(x.trim()))
        .filter(Boolean);
    }

    // (3) Slash alternatives ONLY for these intended shorthand cases
    const allowSlashAlternatives =
      rhsKey === 'clayey/loamy' ||
      rhsKey === 'moderate/well';

    if (allowSlashAlternatives) {
      return s
        .split('/')
        .map(x => x.trim())
        .filter(Boolean)
        .map(x => {
          const pk = normKey_(x);
          if (pk === 'moderate') return 'Moderately / Imperfectly drained';
          if (pk === 'well') return 'Well-drained';
          return x;
        })
        .map(canonicalClassSingle_);
    }

    // Default: treat RHS as a single label (even if it contains "/")
    return [canonicalClassSingle_(rhsRaw)];
  }

  // ---------- Operator parsing ----------
  term = String(term || '').trim().replace('!=', '≠');

  const mEq = term.match(/^(.+?)\s*=\s*(.+)$/);
  const mNeq = term.match(/^(.+?)\s*≠\s*(.+)$/);

  if (mNeq) {
    const aspectRaw = mNeq[1].trim();
    const rhsRaw = mNeq[2].trim();

    const selected = canonicalClassSingle_(getSelected_(aspectRaw));
    const rhsOptions = splitAlternatives_(rhsRaw, aspectRaw);

    return rhsOptions.every(opt => normKey_(selected) !== normKey_(opt));
  }

  if (mEq) {
    const aspectRaw = mEq[1].trim();
    const rhsRaw = mEq[2].trim();

    const selected = canonicalClassSingle_(getSelected_(aspectRaw));
    const rhsOptions = splitAlternatives_(rhsRaw, aspectRaw);

    return rhsOptions.some(opt => normKey_(selected) === normKey_(opt));
  }

  return false;
}





function cpos_norm_(s) {
  return String(s || '')
    .replace(/\u00A0/g, ' ')      // nbsp
    .replace(/[–—]/g, '-')        // en/em dash
    .replace(/CH₄/g, 'CH4')       // subscript
    .trim();
}

// Map common shorthand in IF rules -> canonical Aspect keys used in selections
const CPOS_ASPECT_ALIASES = {
  'Water Mgmt': 'Water Management Intensity',
  'Water Management': 'Water Management Intensity',
  'Bulk Density': 'Bulk Density / Structure',
  'Bulk Density/Structure': 'Bulk Density / Structure',
  'Nutrients': 'Nutrient Availability / Stoichiometry',
  'Soil Texture': 'Soil Texture',
  'Soil pH': 'Soil pH',
  'Crop Type': 'Crop Type',
  'Rainfall': 'Rainfall Pattern',
  'Rainfall Pattern': 'Rainfall Pattern'
};

function cpos_canonicalAspect_(aspect) {
  const a = cpos_norm_(aspect);
  return CPOS_ASPECT_ALIASES[a] || a;
}


/***********************
 * CP-OS v2.0 Backend additions
 * - CPOS_Rules is CACHE (not hardcoded rules)
 * - CPOS_Classes provides pathway texts + MRV vars
 * - Fail-fast gates stay in code
 ***********************/

const CPOS_V2 = {
  ORDER_VERSION: 'v1',
  PATHWAYS: ['RP-SOC', 'AWD-CH₄', 'BIOCHAR', 'ERW'],
  // Pathway-specific ordering (locked + includes Other)
  ORDERS: {
    'AWD-CH₄': [
      'Crop Type',
      'Water Management Intensity',
      'Drainage Class',
      'Operational / Irrigation Control',
      'Temperature Regime',
      'Soil Texture',
      'Bulk Density / Structure',
      'Soil pH',
      'Nutrient Availability / Stoichiometry',
      'Residue Quantity & Quality',
      'Baseline SOC',
      'Soil Mineralogy',
      'Other'
    ],
    'ERW': [
      'Mineral Reactivity',
      'Particle Size / Fineness',
      'Rainfall Pattern',
      'Drainage Class',
      'Soil pH',
      'Crop Type',
      'Bulk Density / Structure',
      'Soil Texture',
      'Temperature Regime',
      'Nutrient Availability / Stoichiometry',
      'Baseline SOC',
      'Soil Mineralogy',
      'Residue Quantity & Quality',
      'Other'
    ],
    'BIOCHAR': [
      'Soil Texture',
      'Rainfall Pattern',
      'Soil pH',
      'Bulk Density / Structure',
      'Drainage Class',
      'Nutrient Availability / Stoichiometry',
      'Residue Quantity & Quality',
      'Baseline SOC',
      'Temperature Regime',
      'Crop Type',
      'Soil Mineralogy',
      'Operational / Irrigation Control',
      'Other'
    ],
    'RP-SOC': [
      'Crop Type',
      'Residue Quantity & Quality',
      'Baseline SOC',
      'Soil Texture',
      'Soil Mineralogy',
      'Nutrient Availability / Stoichiometry',
      'Bulk Density / Structure',
      'Drainage Class',
      'Temperature Regime',
      'Rainfall Pattern',
      'Operational / Irrigation Control',
      'Water Management Intensity',
      'Other'
    ]
  },

  // Allowed MRV tier impact values (your lock)
  MRV_TIER_ALLOWED: ['UP', 'DOWN', 'HIGH', 'STANDARD', 'LIGHT', 'NONE']
};

// ---------- v2 helpers ----------

function cpos_v2_norm_(s) {
  return String(s || '')
    .replace(/\u00A0/g, ' ')
    .replace(/[–—]/g, '-')
    .trim();
}

function cpos_v2_stableJSONStringify_(obj) {
  // stable key order stringify
  if (obj === null || obj === undefined) return '';
  if (typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return JSON.stringify(obj.map(cpos_v2_stableJSONStringify_));
  const keys = Object.keys(obj).sort((a, b) => a.localeCompare(b));
  const out = {};
  keys.forEach(k => { out[k] = obj[k]; });
  return JSON.stringify(out);
}

function cpos_v2_hash_(s) {
  const raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8);
  const hex = raw.map(b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join('');
  return hex.slice(0, 16).toUpperCase(); // short stable
}

function cpos_v2_orderedAspectPairs_(pathwayKey, selections) {
  const order = CPOS_V2.ORDERS[pathwayKey] || [];
  const selKeys = Object.keys(selections || {});
  const used = new Set();

  const pairs = [];

  // add ordered known aspects
  order.forEach(aspect => {
    if (aspect === 'Other') return;
    const v = selections[aspect];
    if (v !== undefined && v !== null && String(v).trim() !== '') {
      pairs.push([aspect, String(v)]);
      used.add(aspect);
    }
  });

  // add "Other" (anything not in order list)
  selKeys.forEach(k => {
    if (used.has(k)) return;
    if (order.includes(k)) return; // already handled
    const v = selections[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') {
      pairs.push([k, String(v)]);
    }
  });

  return pairs;
}

function cpos_v2_makeComboKey_(pathwayKey, selections) {
  const pairs = cpos_v2_orderedAspectPairs_(pathwayKey, selections);
  const canonical = pathwayKey + '|' + CPOS_V2.ORDER_VERSION + '|' +
    pairs.map(p => cpos_v2_norm_(p[0]) + '=' + cpos_v2_norm_(p[1])).join(';');
  const hash = cpos_v2_hash_(canonical);
  return { comboKey: 'CPOS-' + hash, canonical, pairs };
}

// ---------- v2 cache sheet ----------

function cpos_v2_getCacheSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName('CPOS_Rules');
  if (!sh) throw new Error('Missing sheet: CPOS_Rules (v2 cache). Create it with the v2 header row.');
  return sh;
}

function cpos_v2_getCacheIndex_() {
  const sh = cpos_v2_getCacheSheet_();
  const values = sh.getDataRange().getValues();
  if (!values || values.length < 2) return { headers: values[0] || [], idx: {}, rows: [] };

  const headers = (values[0] || []).map(h => String(h || '').trim());
  const idx = {};
  headers.forEach((h, i) => { if (h) idx[h] = i; });

  const rows = [];
  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    const comboKey = row[idx.Combo_Key];
    if (!comboKey) continue;
    rows.push({ r: r + 1, row }); // sheet row number is r+1
  }
  return { headers, idx, rows, sheet: sh };
}

function cpos_v2_cacheGet_(comboKey) {
  const { idx, rows, sheet } = cpos_v2_getCacheIndex_();
  for (const it of rows) {
    if (String(it.row[idx.Combo_Key] || '').trim() === comboKey) {
      // build object
      const obj = {};
      Object.keys(idx).forEach(h => { obj[h] = it.row[idx[h]]; });
      obj.__row = it.r;
      return obj;
    }
  }
  return null;
}

function cpos_v2_cacheTouch_(comboKey) {
  const hit = cpos_v2_cacheGet_(comboKey);
  if (!hit) return false;

  const sh = cpos_v2_getCacheSheet_();
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(h => String(h || '').trim());
  const map = {};
  headers.forEach((h, i) => { map[h] = i + 1; });

  const now = cpos_nowISO_();
  const row = hit.__row;

  if (map.Last_Used_At) sh.getRange(row, map.Last_Used_At).setValue(now);
  if (map.Use_Count) {
    const cur = Number(hit.Use_Count || 0);
    sh.getRange(row, map.Use_Count).setValue(cur + 1);
  }
  return true;
}

function cpos_v2_cachePut_(rowObj) {
  const sh = cpos_v2_getCacheSheet_();
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(h => String(h || '').trim());
  const out = headers.map(h => rowObj[h] !== undefined ? rowObj[h] : '');
  sh.appendRow(out);
}

// ---------- v2 synthesis (human readable + dedupe) ----------

function cpos_v2_splitClauses_(txt) {
  const s = String(txt || '').trim();
  if (!s) return [];
  // split by ; or . but keep meaning
  return s
    .replace(/\s+/g, ' ')
    .split(/[;.]+/)
    .map(x => x.trim())
    .filter(Boolean);
}

function cpos_v2_dedupeClauses_(clauses) {
  const clean = clauses
    .map(c => c.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  // exact dedupe
  const uniq = [];
  const seen = new Set();
  clean.forEach(c => {
    const k = c.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    uniq.push(c);
  });

  // containment dedupe (keep longer)
  const final = [];
  for (let i = 0; i < uniq.length; i++) {
    let keep = true;
    for (let j = 0; j < uniq.length; j++) {
      if (i === j) continue;
      const a = uniq[i].toLowerCase();
      const b = uniq[j].toLowerCase();
      if (b.includes(a) && b.length > a.length + 6) { // b meaningfully longer
        keep = false;
        break;
      }
    }
    if (keep) final.push(uniq[i]);
  }
  return final;
}

function cpos_v2_bucket_(clause) {
  const c = clause.toLowerCase();

  if (/(flood|awd|water|drain|eh|redox|anaerob)/.test(c)) return 'WATER_REDOX';
  if (/(texture|sandy|clay|loam|compaction|bulk density|infiltration|porosity|aggregate)/.test(c)) return 'SOIL_PHYS';
  if (/(residue|biomass|crop|root|microb|cue|nutrient|stoichiometr)/.test(c)) return 'BIO_INPUTS';
  if (/(rain|humid|arid|semi-arid|temp|hot|warm|cool)/.test(c)) return 'CLIMATE';
  if (/(account|mrv|variability|attribution|export|dissolution|alkalinity|dic)/.test(c)) return 'MRV_MECH';
  return 'OTHER';
}

function cpos_v2_sentenceJoin_(clauses) {
  if (!clauses.length) return '';
  // Join as 1–2 sentences max
  const s = clauses.map(c => {
    let x = c.trim();
    if (!x) return '';
    x = x.replace(/\s+/g, ' ');
    // ensure no trailing comma
    x = x.replace(/[,;]\s*$/, '');
    return x;
  }).filter(Boolean);

  // make sentence(s)
  let text = '';
  if (s.length <= 2) {
    text = s.join('. ');
  } else {
    // first two as sentences, remaining appended with ";"
    text = s[0] + '. ' + s[1] + '. ' + s.slice(2).join('; ');
  }
  text = text.trim();
  if (!text) return '';
  if (!/[.!?]$/.test(text)) text += '.';
  return text;
}

function cpos_v2_synthesizeFinalText_(pathwayKey, aspectRowsByClass, orderedPairs) {
  // aspectRowsByClass is from getCPOSData().aspectsMap[aspect].rowsByClass[class]
  const colMap = {
    'RP-SOC': 'RP_SOC_Text',
    'AWD-CH₄': 'AWD_CH4_Text',
    'BIOCHAR': 'BIOCHAR_Text',
    'ERW': 'ERW_Text'
  };
  const textCol = colMap[pathwayKey];

  let clauses = [];
  const mrvSet = new Set();

  orderedPairs.forEach(([aspect, cls]) => {
    // find row data for this aspect/class
    // aspectRowsByClass passed as map { aspect -> { class -> payload } }
    const row = (aspectRowsByClass[aspect] && aspectRowsByClass[aspect][cls]) ? aspectRowsByClass[aspect][cls] : null;
    if (!row) return;

    const txt = String(row[textCol] || '').trim();
    clauses = clauses.concat(cpos_v2_splitClauses_(txt));

    const mrv = String(row.MRV_Variables || '').trim();
    if (mrv) {
      mrv.split(/[,;]+/).map(x => x.trim()).filter(Boolean).forEach(v => mrvSet.add(v));
    }
  });

  clauses = cpos_v2_dedupeClauses_(clauses);

  // bucket + order buckets (keeps logic flow)
  const buckets = { WATER_REDOX: [], SOIL_PHYS: [], BIO_INPUTS: [], CLIMATE: [], MRV_MECH: [], OTHER: [] };
  clauses.forEach(c => buckets[cpos_v2_bucket_(c)].push(c));

  const ordered = []
    .concat(buckets.BIO_INPUTS)
    .concat(buckets.SOIL_PHYS)
    .concat(buckets.WATER_REDOX)
    .concat(buckets.CLIMATE)
    .concat(buckets.MRV_MECH)
    .concat(buckets.OTHER);

  let finalText = cpos_v2_sentenceJoin_(ordered);

  // Append MRV line
  const mrvList = Array.from(mrvSet);
  mrvList.sort((a, b) => a.localeCompare(b));
  if (mrvList.length) {
    const mrvSentence = 'MRV focus: ' + mrvList.join(', ') + '.';
    finalText = (finalText ? (finalText + ' ' + mrvSentence) : mrvSentence);
  }

  return { finalText, mrvList };
}

// ---------- v2 impacts + gates (fail-fast) ----------

function cpos_v2_applyImpact_(acc, impact) {
  // acc: { eligibility, priorityScore, mrvScore, flags:Set }
  if (!impact) return;

  const elig = String(impact.eligibility || '').toUpperCase().trim();
  if (elig === 'NO') acc.eligibility = 'NO';
  else if (elig === 'CONDITIONAL' && acc.eligibility !== 'NO') acc.eligibility = 'CONDITIONAL';

  const pr = String(impact.priority || '').toUpperCase().trim();
  if (pr === 'UP_UP') acc.priorityScore += 2;
  else if (pr === 'UP') acc.priorityScore += 1;
  else if (pr === 'DOWN_DOWN') acc.priorityScore -= 2;
  else if (pr === 'DOWN') acc.priorityScore -= 1;

  const mrv = String(impact.mrvTier || '').toUpperCase().trim();
  // Allowed: UP/DOWN/HIGH/STANDARD/LIGHT/NONE
  if (!CPOS_V2.MRV_TIER_ALLOWED.includes(mrv) && mrv) {
    // ignore invalid
  } else {
    if (mrv === 'HIGH' || mrv === 'UP') acc.mrvScore += 1;
    else if (mrv === 'LIGHT' || mrv === 'DOWN') acc.mrvScore -= 1;
    else if (mrv === 'STANDARD' || mrv === 'NONE') { /* no score */ }
  }

  (impact.flags || []).forEach(f => { if (f) acc.flags.add(String(f)); });
}

function cpos_v2_finalizeImpacts_(acc) {
  let priority = 'MEDIUM';
  if (acc.eligibility === 'NO') priority = 'LOW';
  else if (acc.priorityScore >= 2) priority = 'HIGH';
  else if (acc.priorityScore <= -2) priority = 'LOW';

  let mrvTier = 'STANDARD';
  if (acc.mrvScore >= 1) mrvTier = 'HIGH';
  else if (acc.mrvScore <= -1) mrvTier = 'LIGHT';

  return {
    Eligibility_Impact: acc.eligibility,
    Priority_Impact: priority,
    MRV_Tier_Impact: mrvTier,
    Risk_Flags: Array.from(acc.flags).slice(0, 8)
  };
}

function cpos_v2_failFast_(pathwayKey, selections) {
  // Return: { invalid: true/false, impacts: [...], invalidReason }
  const imp = [];
  const S = selections || {};

  if (pathwayKey === 'AWD-CH₄') {
    if (S['Crop Type'] && S['Crop Type'] !== 'Rice (flooded)') {
      return { invalid: true, invalidReason: 'AWD-CH₄ requires Crop Type = Rice (flooded).', impacts: [{ eligibility: 'NO', flags: ['Non-paddy system'] }] };
    }
    if (S['Water Management Intensity'] === 'Aerobic / upland') {
      return { invalid: true, invalidReason: 'No flooded baseline → no methane avoidance claim.', impacts: [{ eligibility: 'NO', flags: ['No flooded baseline'] }] };
    }
    if (S['Operational / Irrigation Control'] === 'Low / Uncontrolled') {
      imp.push({ eligibility: 'CONDITIONAL', mrvTier: 'HIGH', flags: ['High operational risk (AWD control)'] });
    }
    if (S['Water Management Intensity'] === 'Continuous flooding') {
      imp.push({ priority: 'UP', flags: ['High baseline CH₄ (flooded)'] });
    }
  }

  if (pathwayKey === 'ERW') {
    if (S['Rainfall Pattern'] === 'Arid / Low rainfall') {
      imp.push({ eligibility: 'CONDITIONAL', priority: 'DOWN', mrvTier: 'HIGH', flags: ['Low water flux limits ERW'] });
    }
    if (S['Mineral Reactivity'] === 'Low (e.g. inert silicates)' && S['Particle Size / Fineness'] === 'Coarse') {
      imp.push({ eligibility: 'CONDITIONAL', priority: 'DOWN_DOWN', flags: ['Low kinetics (reactivity+PSA)'] });
    }
  }

  if (pathwayKey === 'BIOCHAR') {
    // supply chain QC flag is not an aspect, but you already used it in rules.
    // If you capture it in selections as a boolean-like field, gate here:
    if (S['Supply_Chain_QC_Assured'] === false || String(S['Supply_Chain_QC_Assured']).toLowerCase() === 'false') {
      imp.push({ eligibility: 'CONDITIONAL', mrvTier: 'HIGH', flags: ['Biochar QC not assured'] });
    }
    if (S['Drainage Class'] === 'Poorly drained / Waterlogged') {
      imp.push({ eligibility: 'CONDITIONAL', mrvTier: 'UP', flags: ['Waterlogged incorporation/aeration constraint'] });
    }
  }

  if (pathwayKey === 'RP-SOC') {
    if (S['Residue Quantity & Quality'] === 'Low quantity / High C:N' && S['Crop Type'] && S['Crop Type'] !== 'Perennials (grasses, trees)') {
      imp.push({ eligibility: 'CONDITIONAL', mrvTier: 'UP', flags: ['Input-limited SOC pathway'] });
    }
    if (S['Baseline SOC'] === 'High (near saturation)') {
      imp.push({ priority: 'DOWN', mrvTier: 'UP', flags: ['Near SOC saturation'] });
    }
  }

  return { invalid: false, impacts: imp, invalidReason: '' };
}




// ---------- v2 main evaluation (cache-first) ----------


function cpos_buildOrderedSelections_(pathway, selections, aspectsMap) {
  const order = CPOS_PATHWAY_ORDERS[pathway] || [];
  const chosen = {};
  const used = new Set();

  // helper: add an aspect if selected
  function add_(a) {
    if (!a || used.has(a)) return;
    if (selections[a] === undefined || selections[a] === null || selections[a] === '') return;

    // If you want to include unknown aspects too, remove this guard.
    if (aspectsMap && aspectsMap[a]) {
      chosen[a] = String(selections[a]);
      used.add(a);
    }
  }

  // Walk the pathway order. When we hit "Other", append remaining selections.
  order.forEach(a => {
    if (a === 'Other') {
      Object.keys(selections || {}).forEach(k => add_(k));
    } else {
      add_(a);
    }
  });

  // If "Other" wasn’t present in order for some reason, still append remaining.
  Object.keys(selections || {}).forEach(k => add_(k));

  return chosen;
}



function cpos_buildComboKey_(pathway, orderVersion, orderedSelections) {
  function norm_(s) {
    return String(s || '')
      .trim()
      .replace(/\u00A0/g, ' ')
      .replace(/[–—]/g, '-')
      .replace(/\s+/g, ' ')
      .replace(/\s*\/\s*/g, ' / ')
      .trim();
  }

  const keys = Object.keys(orderedSelections || []);
  // keys are already deterministic if chosen was built deterministically,
  // but this makes it bulletproof:
  // DO NOT sort; it would destroy pathway order semantics.
  const parts = keys.map(k => norm_(k) + '=' + norm_(orderedSelections[k]));
  return `${pathway}|${orderVersion}|${parts.join(';')}`;
}



function cpos_assertRulesCacheHeader_() {
  const sh = cpos_getSheet_('CPOS_Rules');
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(h => String(h || '').trim());
  const mustHave = ['Combo_Key', 'Pathway_Key', 'Order_Version', 'Aspect_Selections_JSON', 'Final_Text', 'Use_Count', 'Is_Enabled'];
  const missing = mustHave.filter(h => !headers.includes(h));
  if (missing.length) {
    throw new Error('CPOS_Rules header mismatch. Missing: ' + missing.join(', ') + '. Delete old rows and keep only new cache header.');
  }
}


/***************************************
 * CPOS_Rules cache: indexed fast-path
 * - Builds in-memory index once per execution
 * - O(1) get/touch/upsert by Combo_Key
 ***************************************/

// In-memory index (per execution)
let __CPOS_RULES_CACHE_INDEX__ = null;

/**
 * Build or return the cache index for CPOS_Rules.
 * Index contains:
 * - headers, colIdx
 * - keyToRow (Map Combo_Key -> sheetRowNumber)
 * - values (2D array snapshot)
 */
function cpos_rulesCache_getIndex_(forceRefresh) {
  if (__CPOS_RULES_CACHE_INDEX__ && !forceRefresh) return __CPOS_RULES_CACHE_INDEX__;

  // Ensure CPOS_Rules is in cache-header mode
  cpos_assertRulesCacheHeader_();

  const sh = cpos_getSheet_('CPOS_Rules');
  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();

  // If sheet has only header or is empty-ish
  if (lastRow < 1 || lastCol < 1) {
    __CPOS_RULES_CACHE_INDEX__ = {
      sheet: sh,
      headers: [],
      colIdx: {},
      values: [],
      keyToRow: new Map(),
      col: { comboKey: -1, lastUsedAt: -1, useCount: -1 }
    };
    return __CPOS_RULES_CACHE_INDEX__;
  }

  // Read once
  const values = sh.getRange(1, 1, lastRow, lastCol).getValues();
  const headers = (values[0] || []).map(h => String(h || '').trim());

  const colIdx = {};
  headers.forEach((h, i) => { if (h) colIdx[h] = i; });

  const comboKeyIdx = colIdx['Combo_Key'];
  if (comboKeyIdx === undefined) throw new Error('CPOS_Rules missing header Combo_Key');

  const lastUsedIdx = (colIdx['Last_Used_At'] !== undefined) ? colIdx['Last_Used_At'] : -1;
  const useCountIdx = (colIdx['Use_Count'] !== undefined) ? colIdx['Use_Count'] : -1;

  // Map Combo_Key -> sheet row number (1-based)
  const keyToRow = new Map();
  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    const key = String(row[comboKeyIdx] || '').trim();
    if (!key) continue;
    // If duplicates exist, keep the first seen (older) deterministically
    if (!keyToRow.has(key)) keyToRow.set(key, r + 1);
  }

  __CPOS_RULES_CACHE_INDEX__ = {
    sheet: sh,
    headers,
    colIdx,
    values,      // snapshot; we keep it updated on writes
    keyToRow,
    col: { comboKey: comboKeyIdx, lastUsedAt: lastUsedIdx, useCount: useCountIdx }
  };

  return __CPOS_RULES_CACHE_INDEX__;
}

function cpos_rulesCache_rowArrayToObj_(headers, rowArr) {
  const obj = {};
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i];
    if (!h) continue;
    obj[h] = rowArr[i];
  }
  return obj;
}

/**
 * FAST get by Combo_Key (O(1)).
 * Returns row object (with __row sheet row number) or null.
 */
function cpos_rulesCache_getByKey_(comboKey) {
  cpos_assertRulesCacheHeader_();

  const key = String(comboKey || '').trim();
  if (!key) return null;

  const idx = cpos_rulesCache_getIndex_(false);
  const rowNum = idx.keyToRow.get(key);
  if (!rowNum) return null;

  const rowArr = idx.values[rowNum - 1];
  if (!rowArr) return null;

  const obj = cpos_rulesCache_rowArrayToObj_(idx.headers, rowArr);
  obj.__row = rowNum;
  return obj;
}

/**
 * FAST touch (O(1)) using __row when available.
 * Updates Last_Used_At and increments Use_Count.
 */
function cpos_rulesCache_touch_(rowObj) {
  cpos_assertRulesCacheHeader_();

  const idx = cpos_rulesCache_getIndex_(false);
  const sh = idx.sheet;

  const key = String(rowObj?.Combo_Key || '').trim();
  if (!key) return;

  let rowNum = Number(rowObj?.__row || 0);
  if (!rowNum) rowNum = idx.keyToRow.get(key) || 0;
  if (!rowNum) return;

  const now = cpos_nowISO_();

  // Update Last_Used_At
  if (idx.col.lastUsedAt >= 0) {
    sh.getRange(rowNum, idx.col.lastUsedAt + 1).setValue(now);
    // keep snapshot in sync
    if (idx.values[rowNum - 1]) idx.values[rowNum - 1][idx.col.lastUsedAt] = now;
  }

  // Increment Use_Count
  if (idx.col.useCount >= 0) {
    const cur = Number((idx.values[rowNum - 1] || [])[idx.col.useCount] || 0);
    const next = cur + 1;
    sh.getRange(rowNum, idx.col.useCount + 1).setValue(next);
    if (idx.values[rowNum - 1]) idx.values[rowNum - 1][idx.col.useCount] = next;
  }
}

/**
 * FAST upsert (O(1)).
 * - If Combo_Key exists: update row in-place
 * - Else: append new row (setValues) + update index
 */
function cpos_rulesCache_upsert_(rowObj) {
  cpos_assertRulesCacheHeader_();

  const idx = cpos_rulesCache_getIndex_(false);
  const sh = idx.sheet;

  const key = String(rowObj?.Combo_Key || '').trim();
  if (!key) throw new Error('cpos_rulesCache_upsert_: Combo_Key missing');

  const headers = idx.headers;

  // Exists? update
  const existingRowNum = idx.keyToRow.get(key);
  if (existingRowNum) {
    const r = existingRowNum;

    const prev = idx.values[r - 1] || new Array(headers.length).fill('');
    const out = headers.map((h, i) => {
      if (!h) return prev[i];
      return (rowObj[h] !== undefined) ? rowObj[h] : prev[i];
    });

    sh.getRange(r, 1, 1, headers.length).setValues([out]);

    // sync snapshot
    idx.values[r - 1] = out;

    return;
  }

  // Not found: append
  const out = headers.map(h => (h && rowObj[h] !== undefined) ? rowObj[h] : '');
  const newRowNum = sh.getLastRow() + 1;

  sh.getRange(newRowNum, 1, 1, headers.length).setValues([out]);

  // Update index snapshot + map
  idx.values[newRowNum - 1] = out;
  idx.keyToRow.set(key, newRowNum);
}




function cpos_buildCacheRow_(p) {
  const now = cpos_nowISO_();

  const ordered = p.ordered || {};
  const human = Object.keys(ordered).map(k => `${k}: ${ordered[k]}`).join(' | ');

  const mrvVars = Array.isArray(p.mrvVars) ? [...new Set(p.mrvVars.filter(Boolean))] : [];
  const flags = Array.isArray(p.flags) ? [...new Set(p.flags.filter(Boolean))] : [];

  return {
    Combo_Key: p.comboKey,
    Pathway_Key: p.pathway,
    Order_Version: CPOS_ORDER_VERSION,

    Aspect_Selections_JSON: JSON.stringify(ordered),
    Aspect_List_Human: human,

    Final_Text: String(p.finalText || ''),

    MRV_Variables_JSON: JSON.stringify(mrvVars),
    MRV_Variables_Text: mrvVars.join('; '),

    Eligibility_Impact: (p.eligibilityImpact || '').toUpperCase(),
    Priority_Impact: (p.priorityImpact || 'NONE').toUpperCase(), // UP/DOWN/NONE
    MRV_Tier_Impact: cpos_normMrvTierImpact_(p.mrvTierImpact || 'NONE'),

    Risk_Flags_JSON: JSON.stringify(flags),
    Risk_Flags_Text: flags.join('; '),

    Invalid_Reason: String(p.invalidReason || ''),

    Created_At: now,
    Last_Used_At: now,
    Use_Count: 1,
    Source: 'AUTO_GEN',
    Is_Enabled: true,
    Notes: ''
  };
}

function cpos_cachedRow_toResult_(r) {
  // ---- helpers ----
  const cleanStr = (v) => String(v ?? '').trim();
  const normToken = (v) => cleanStr(v).toUpperCase();
  const isNullishToken = (s) => {
    const t = normToken(s);
    return !t || t === 'NULL' || t === 'N/A' || t === 'NA' || t === 'UNDEFINED' || t === 'NONE' || t === '0';
  };

  // ---- normalize core fields ----
  // Eligibility_Impact: allow YES / NO / CONDITIONAL; default YES
  let elig = normToken(r.Eligibility_Impact);
  if (isNullishToken(elig)) elig = 'YES';
  if (elig === 'Y') elig = 'YES';
  if (elig === 'N') elig = 'NO';
  if (elig !== 'YES' && elig !== 'NO' && elig !== 'CONDITIONAL') elig = 'YES';

  // Priority_Impact: allow UP / DOWN / NONE; default NONE
  let pr = normToken(r.Priority_Impact);
  if (isNullishToken(pr)) pr = 'NONE';
  if (pr !== 'UP' && pr !== 'DOWN' && pr !== 'NONE') pr = 'NONE';

  // MRV_Tier_Impact: normalize via your helper; default NONE
  const mtRaw = cleanStr(r.MRV_Tier_Impact);
  let mt = 'NONE';
  try {
    mt = cpos_normMrvTierImpact_(mtRaw || 'NONE');
  } catch (e) {
    mt = 'NONE';
  }
  mt = normToken(mt);
  if (isNullishToken(mt)) mt = 'NONE';

  // ---- map Priority_Impact -> HIGH/MEDIUM/LOW ----
  let priority = 'MEDIUM';
  if (elig === 'NO') priority = 'LOW';
  else if (pr === 'UP') priority = 'HIGH';
  else if (pr === 'DOWN') priority = 'LOW';

  // ---- map MRV_Tier_Impact -> LIGHT/STANDARD/HIGH ----
  // Accepts HIGH/LIGHT/STANDARD or UP/DOWN as synonyms.
  let mrv_tier = 'STANDARD';
  if (mt === 'HIGH' || mt === 'UP') mrv_tier = 'HIGH';
  else if (mt === 'LIGHT' || mt === 'DOWN') mrv_tier = 'LIGHT';
  else if (mt === 'STANDARD') mrv_tier = 'STANDARD';
  else mrv_tier = 'STANDARD';

  // ---- parse JSON fields safely ----
  const safeJsonArray = (v) => {
    try {
      const x = JSON.parse(cleanStr(v) || '[]');
      return Array.isArray(x) ? x : [];
    } catch (e) {
      return [];
    }
  };

  let flags = safeJsonArray(r.Risk_Flags_JSON);
  let mrvVars = safeJsonArray(r.MRV_Variables_JSON);

  // ---- Reasons generation ----
  const reasons = [];

  // 1) invalid gate reason first
  const inv = cleanStr(r.Invalid_Reason);
  if (inv) reasons.push(inv);

  // 2) eligibility summary
  if (elig === 'NO') reasons.push('Not eligible under current site context.');
  else if (elig === 'CONDITIONAL') reasons.push('Conditionally feasible; requires stronger evidence / controls.');
  else reasons.push('Eligible under current site context.');

  // 3) priority rationale
  if (pr === 'UP') reasons.push('High mitigation / impact potential (priority ↑).');
  else if (pr === 'DOWN') reasons.push('Lower expected impact potential (priority ↓).');

  // 4) MRV rationale
  if (mt === 'HIGH') reasons.push('High MRV burden likely (high-frequency monitoring / audit trail).');
  else if (mt === 'UP') reasons.push('MRV burden likely higher due to uncertainty / variability.');
  else if (mt === 'LIGHT' || mt === 'DOWN') reasons.push('MRV burden can be lighter with current assumptions.');

  // 5) convert some flags into reasons (top 2)
  const topFlags = (flags || []).filter(f => cleanStr(f)).slice(0, 2);
  topFlags.forEach(f => reasons.push(cleanStr(f)));

  // 6) if still too empty, use a short excerpt from final text
  const ft = cleanStr(r.Final_Text);
  if (reasons.length < 2 && ft) {
    const first = ft
      .split('.')
      .map(s => s.trim())
      .filter(Boolean)[0];
    if (first) reasons.push(first.endsWith('.') ? first : (first + '.'));
  }

  // cap + de-dup (case-insensitive)
  const dedup = [];
  const seen = new Set();
  reasons.forEach(x => {
    const t = cleanStr(x);
    if (!t) return;
    const k = t.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    dedup.push(t);
  });

  return {
    eligibility: elig,
    priority: priority,
    mrv_tier: mrv_tier,
    reasons: dedup.slice(0, 4),
    flags: (flags || []).slice(0, 6),
    final_text: ft,
    mrv_variables: mrvVars
  };
}





function cpos_normMrvTierImpact_(v) {
  const s = String(v || '').trim().toUpperCase();
  const allowed = new Set(['UP', 'DOWN', 'HIGH', 'STANDARD', 'LIGHT', 'NONE']);
  if (allowed.has(s)) return s;
  return 'NONE';
}

function cpos_synthesize_(pathway, orderedSelections, aspectsMap) {
  const pathwayTextField =
    (pathway === 'RP-SOC') ? 'RP_SOC_Text' :
      (pathway === 'AWD-CH₄') ? 'AWD_CH4_Text' :
        (pathway === 'BIOCHAR') ? 'BIOCHAR_Text' :
          'ERW_Text';

  const fragments = [];
  const mrvVars = [];

  Object.keys(orderedSelections || {}).forEach(aspect => {
    const cls = String(orderedSelections[aspect] || '').trim();
    const map = aspectsMap[aspect];
    if (!map || !map.rowsByClass || !map.rowsByClass[cls]) return;

    const row = map.rowsByClass[cls];

    const t = String(row[pathwayTextField] || '').trim();
    if (t) fragments.push(t);

    const mv = String(row.MRV_Variables || '').trim();
    if (mv) mv.split(/[;,|]/).map(x => x.trim()).filter(Boolean).forEach(x => mrvVars.push(x));
  });

  const cleaned = cpos_cleanAndDedupeFragments_(fragments);
  const finalText = cpos_composeFinalNarrative_(pathway, cleaned);

  return {
    finalText,
    mrvVars: [...new Set(mrvVars)]
  };
}

function cpos_cleanAndDedupeFragments_(fragments) {
  const norm = s => String(s || '')
    .trim()
    .replace(/\u00A0/g, ' ')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/\s*\.\s*$/g, '')
    .trim();

  const out = [];
  for (const f of (fragments || [])) {
    const x = norm(f);
    if (!x) continue;

    const xl = x.toLowerCase();

    // drop if fully contained in existing, or replace if it contains existing
    let handled = false;
    for (let i = 0; i < out.length; i++) {
      const yl = out[i].toLowerCase();
      if (yl.includes(xl)) { handled = true; break; }
      if (xl.includes(yl)) { out[i] = x; handled = true; break; }
    }
    if (handled) continue;

    out.push(x);
  }

  // small cosmetic cleanup
  return out.map(s =>
    s.replace(/\s+and\s+and\s+/gi, ' and ')
      .replace(/\b(Strong|High|Good)\s+(Strong|High|Good)\b/gi, '$1')
      .trim()
  );
}

function cpos_composeFinalNarrative_(pathway, fragments) {
  const parts = (fragments || []).filter(Boolean);
  if (!parts.length) return '';

  // If only one fragment, keep it clean.
  if (parts.length === 1) return parts[0].endsWith('.') ? parts[0] : (parts[0] + '.');

  // Join with varied connectors to read “human”
  const joined = [];
  for (let i = 0; i < parts.length; i++) {
    const s = parts[i];
    if (i === 0) joined.push(s);
    else if (i === 1) joined.push('This is relevant because ' + lowerFirst_(s));
    else if (i === parts.length - 1) joined.push('Overall, ' + lowerFirst_(s));
    else joined.push('Additionally, ' + lowerFirst_(s));
  }

  let paragraph = joined.join('. ').replace(/\.\.+/g, '.').trim();
  if (!paragraph.endsWith('.')) paragraph += '.';

  // Optional short closer per pathway (only if it adds meaning)
  const closer = cpos_pathwayCloser_(pathway);
  if (closer) paragraph += ' ' + closer;

  return paragraph;

  function lowerFirst_(x) {
    x = String(x || '').trim();
    if (!x) return x;
    return x.charAt(0).toLowerCase() + x.slice(1);
  }
}

function cpos_pathwayCloser_(pathway) {
  if (pathway === 'AWD-CH₄') return 'Focus on defensible wet–dry scheduling and field evidence of drainage events.';
  if (pathway === 'ERW') return 'Prioritize chemistry MRV that can attribute alkalinity generation and transport.';
  if (pathway === 'BIOCHAR') return 'Ensure feedstock/QC and application method are documented to support permanence claims.';
  if (pathway === 'RP-SOC') return 'Emphasize sustained biomass inputs and practices that reduce disturbance and reversal risk.';
  return '';
}


function cpos_dedupeTextFragments_(fragments) {
  const norm = s => String(s || '')
    .trim()
    .replace(/\u00A0/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[–—]/g, '-')
    .replace(/\s*\.\s*/g, '. ')
    .trim();

  // remove empties + exact duplicates
  const uniq = [];
  const seen = new Set();
  for (const f of (fragments || [])) {
    const x = norm(f);
    if (!x) continue;
    const k = x.toLowerCase();
    if (seen.has(k)) continue;
    uniq.push(x);
    seen.add(k);
  }

  // remove containment duplicates (keep longer)
  const out = [];
  for (const x of uniq) {
    const xl = x.toLowerCase();
    let skip = false;
    for (let i = 0; i < out.length; i++) {
      const yl = out[i].toLowerCase();
      if (yl.includes(xl)) { skip = true; break; }
      if (xl.includes(yl)) { out[i] = x; skip = true; break; } // replace shorter
    }
    if (!skip) out.push(x);
  }

  return out;
}


function cpos_pathwayCloserSummary_(pathway, orderedSelections, nBenefit, nRisk) {
  orderedSelections = orderedSelections || {};
  nBenefit = Number(nBenefit || 0);
  nRisk = Number(nRisk || 0);

  // short, human-readable summary line (1 sentence max)
  if (pathway === 'AWD-CH₄') {
    if (String(orderedSelections['Crop Type'] || '') !== 'Rice (flooded)') return 'This system does not provide a credible flooded baseline for AWD methane avoidance.';
    if (nRisk > nBenefit) return 'Overall, AWD methane claims are plausible but will need stronger operational evidence and MRV due to execution/variability risks.';
    return 'Overall, AWD methane reduction looks promising here, with MRV focused on AWD cycle evidence and CH₄ variability drivers.';
  }
  if (pathway === 'ERW') {
    if (!orderedSelections['Mineral Reactivity'] || !orderedSelections['Particle Size / Fineness']) return 'ERW potential is directionally positive but should be treated as conditional until reactivity and particle size are confirmed.';
    if (nRisk > nBenefit) return 'Overall, ERW may work but attribution and chemistry MRV effort will be higher under these constraints.';
    return 'Overall, ERW looks favorable here, with MRV centered on material properties, dissolution proxies, and alkalinity export signal.';
  }
  if (pathway === 'BIOCHAR') {
    if (nRisk > nBenefit) return 'Overall, biochar benefits are likely, but quality control and incorporation feasibility will drive outcomes and MRV burden.';
    return 'Overall, biochar is a strong fit here, combining agronomic co-benefits with SOC permanence where application and QC are controlled.';
  }
  // RP-SOC
  if (nRisk > nBenefit) return 'Overall, SOC gains are possible but are likely input- or constraint-limited; focus on biomass pathway and reversals risk management.';
  return 'Overall, regenerative SOC outcomes look favorable here if biomass inputs and disturbance controls are maintained.';
}





function cpos_failFastGate_(pathway, orderedSelections, allSelections) {
  // AWD-CH₄ must be rice flooded baseline (else NO)
  if (pathway === 'AWD-CH₄') {
    const crop = String(allSelections['Crop Type'] || '');
    if (crop && crop !== 'Rice (flooded)') {
      return { invalid: true, reason: 'AWD-CH₄ applies only to Rice (flooded) systems.', eligibility: 'NO', mrv_tier_impact: 'NONE', flags: ['Non-paddy system'] };
    }
    const wm = String(allSelections['Water Management Intensity'] || '');
    if (wm && wm === 'Aerobic / upland') {
      return { invalid: true, reason: 'No flooded baseline → no methane avoidance claim for AWD-CH₄.', eligibility: 'NO', mrv_tier_impact: 'NONE', flags: ['No flooded baseline'] };
    }
  }

  // ERW: (optional) if both reactivity + particle size missing, make CONDITIONAL
  if (pathway === 'ERW') {
    const r = String(allSelections['Mineral Reactivity'] || '');
    const p = String(allSelections['Particle Size / Fineness'] || '');
    if (!r || !p) {
      return { invalid: false }; // not invalid; let it synthesize, but impacts can become CONDITIONAL
    }
  }

  return null;
}


function cpos_deriveImpacts_(pathway, orderedSelections, allSelections, synth) {
  let eligibility = 'YES';
  let priority_impact = 'NONE';        // UP / DOWN / NONE
  let mrv_tier_impact = 'STANDARD';    // UP / DOWN / HIGH / STANDARD / LIGHT / NONE

  const flags = [];

  // -------------------------
  // Helpers
  // -------------------------
  const get = (k) => String(allSelections?.[k] || '').trim();

  const bumpPriority = (dir) => {
    // priority_impact is single value; keep strongest
    // DOWN overrides UP? (you can choose; here NO: UP wins unless already DOWN set)
    if (dir === 'UP') {
      if (priority_impact !== 'DOWN') priority_impact = 'UP';
    } else if (dir === 'DOWN') {
      priority_impact = 'DOWN';
    }
  };

  const bumpMRV = (dir) => {
    // keep strongest burden: HIGH > UP > STANDARD > DOWN > LIGHT
    const rank = { 'HIGH': 5, 'UP': 4, 'STANDARD': 3, 'DOWN': 2, 'LIGHT': 1, 'NONE': 0 };
    const cur = String(mrv_tier_impact || 'STANDARD').toUpperCase();
    const nxt = String(dir || 'STANDARD').toUpperCase();
    if ((rank[nxt] ?? 0) > (rank[cur] ?? 0)) mrv_tier_impact = nxt;
    if ((rank[nxt] ?? 0) < (rank[cur] ?? 0) && (nxt === 'DOWN' || nxt === 'LIGHT')) {
      // allow lowering only if explicitly called and not already HIGH/UP
      if (cur === 'STANDARD') mrv_tier_impact = nxt;
    }
  };

  // If you want: never reduce MRV below STANDARD automatically, comment the DOWN/LIGHT branch above.

  // -------------------------
  // 0) Text-based uncertainty (keep your original idea)
  // -------------------------
  const text = String(synth?.finalText || '').toLowerCase();
  if (/(uncertain|variability|harder|risk|complex|audit|evidence|log)/i.test(text)) {
    bumpMRV('UP');
    flags.push('Higher uncertainty / variability');
  }

  // -------------------------
  // 1) Pathway applicability & dominant drivers (based on your classes table)
  // -------------------------

  // Climate
  const temp = get('Temperature Regime');
  const rain = get('Rainfall Pattern');

  if (temp === 'Hot (>25 °C)') {
    if (pathway === 'AWD-CH₄') { bumpMRV('UP'); bumpPriority('UP'); flags.push('High temp variability (CH₄)'); }
    if (pathway === 'RP-SOC') { bumpPriority('DOWN'); flags.push('High SOC turnover risk (hot)'); }
    if (pathway === 'ERW') { bumpPriority('UP'); flags.push('Faster kinetics if moisture adequate (hot)'); }
  }
  if (temp === 'Cool (≤15 °C mean)' && pathway === 'ERW') {
    bumpPriority('DOWN');
    flags.push('Slow dissolution kinetics (cool)');
  }

  if (rain === 'Arid / Low rainfall') {
    if (pathway === 'RP-SOC') { bumpPriority('DOWN'); bumpMRV('UP'); flags.push('Biomass-limited SOC potential (arid)'); }
    if (pathway === 'ERW') { bumpPriority('DOWN'); flags.push('Limited water flux for ERW (arid)'); }
  }
  if (rain === 'Humid / High rainfall') {
    if (pathway === 'ERW') { bumpPriority('UP'); flags.push('Favorable dissolution + export (humid)'); }
    if (pathway === 'RP-SOC') { bumpPriority('UP'); flags.push('High biomass potential (humid)'); }
  }

  // Biology
  const crop = get('Crop Type');
  if (pathway === 'AWD-CH₄') {
    // eligibility gating is already handled in cpos_failFastGate_
    // but if rice flooded selected, we can increase priority baseline when flooding intensity is high
    // (handled below in Water Management)
  } else {
    // non-AWD pathways: crop affects SOC/ERW suitability
    if (crop === 'Perennials (grasses, trees)') {
      if (pathway === 'RP-SOC') { bumpPriority('UP'); flags.push('High SOC potential via deep roots (perennials)'); }
      if (pathway === 'ERW') { bumpPriority('UP'); flags.push('Long residence time supports ERW attribution'); }
    }
    if (crop === 'Legumes' && pathway === 'ERW') {
      bumpPriority('UP');
      flags.push('Rhizosphere acidification can enhance dissolution (legumes)');
    }
  }

  // Management
  const water = get('Water Management Intensity');
  const control = get('Operational / Irrigation Control');

  if (pathway === 'AWD-CH₄') {
    if (water === 'Continuous flooding') {
      bumpPriority('UP');
      flags.push('High CH₄ baseline (flooded) → higher mitigation potential');
    }
    if (water === 'AWD (intermittent drying)') {
      bumpPriority('UP');
      flags.push('AWD regime selected (mitigation feasible)');
    }
    if (water === 'Aerobic / upland') {
      // failFast already sets NO; but keep consistency if it bypassed
      eligibility = 'NO';
      flags.push('No flooded baseline for AWD-CH₄');
    }

    if (control === 'Low / Uncontrolled') {
      eligibility = 'CONDITIONAL';
      bumpMRV('HIGH'); // strong MRV burden
      flags.push('High operational risk (AWD control)');
    }
    if (control === 'High (controlled irrigation)') {
      bumpMRV('DOWN'); // may relax MRV if you allow it
      flags.push('Good irrigation control evidence possible');
    }
  }

  // Soil
  const texture = get('Soil Texture');
  const ph = get('Soil pH');
  const drainage = get('Drainage Class');
  const bd = get('Bulk Density / Structure');
  const soc = get('Baseline SOC');
  const mineralogy = get('Soil Mineralogy');
  const residue = get('Residue Quantity & Quality');
  const nutrient = get('Nutrient Availability / Stoichiometry');

  // Bulk density / structure — keep your original but make it pathway-aware
  if (bd === 'Compacted') {
    bumpMRV('UP');
    flags.push('Compaction constraint');
    if (pathway === 'RP-SOC') bumpPriority('DOWN');
    if (pathway === 'BIOCHAR') bumpPriority('UP'); // biochar can help porosity but MRV harder
    if (pathway === 'ERW') bumpPriority('DOWN');   // weaker signal / transport
    if (pathway === 'AWD-CH₄') bumpPriority('DOWN'); // gas diffusion uncertainty
  }

  // Drainage
  if (drainage === 'Poorly drained / Waterlogged') {
    if (pathway === 'AWD-CH₄') { bumpPriority('UP'); bumpMRV('UP'); flags.push('Very high CH₄ baseline + execution complexity'); }
    if (pathway === 'RP-SOC') { bumpPriority('DOWN'); flags.push('Anaerobic losses risk for SOC'); }
    if (pathway === 'ERW') { bumpMRV('UP'); flags.push('Transport/accounting uncertainty in waterlogged soils'); }
  }
  if (drainage === 'Well-drained') {
    if (pathway === 'ERW') bumpPriority('UP');
    if (pathway === 'AWD-CH₄') bumpPriority('DOWN'); // low baseline CH4 → less useful
  }

  // Soil pH
  if (ph === 'Acidic (<6.5)') {
    if (pathway === 'ERW') { bumpPriority('UP'); flags.push('Faster dissolution likely (acidic)'); }
    if (pathway === 'BIOCHAR') { bumpPriority('UP'); flags.push('Biochar pH correction co-benefit (acidic)'); }
  }
  if (ph === 'Alkaline (>7.5)') {
    if (pathway === 'ERW') { bumpPriority('DOWN'); bumpMRV('UP'); flags.push('Dissolution slows + carbonate accounting complexity (alkaline)'); }
    if (pathway === 'RP-SOC') { bumpPriority('DOWN'); flags.push('Micronutrient limits can constrain biomass (alkaline)'); }
  }

  // Baseline SOC
  if (soc === 'Low (far from saturation)') {
    if (pathway === 'RP-SOC') { bumpPriority('UP'); flags.push('High marginal SOC gain potential (low baseline SOC)'); }
    if (pathway === 'BIOCHAR') { bumpPriority('UP'); flags.push('Biochar response often strong (low SOC)'); }
  }
  if (soc === 'High (near saturation)') {
    if (pathway === 'RP-SOC') { bumpPriority('DOWN'); flags.push('SOC near saturation → marginal gains slower'); }
    if (pathway === 'ERW') { bumpPriority('UP'); flags.push('ERW becomes durable anchor where SOC saturates'); }
  }

  // Soil mineralogy
  if (mineralogy === 'High oxide content (Fe/Al rich)') {
    if (pathway === 'RP-SOC') { bumpPriority('UP'); flags.push('High MAOC formation potential (Fe/Al oxides)'); }
    if (pathway === 'BIOCHAR') { bumpPriority('UP'); flags.push('Strong stabilization / sorption (Fe/Al oxides)'); }
    if (pathway === 'ERW') { bumpPriority('UP'); flags.push('Favorable reactive surfaces for ERW signal'); }
  }
  if (mineralogy === 'Low oxide content (low Fe/Al)') {
    if (pathway === 'RP-SOC') bumpPriority('DOWN');
    if (pathway === 'ERW') bumpPriority('DOWN');
  }

  // Residues & nutrients (SOC pathways)
  if (pathway === 'RP-SOC') {
    if (residue === 'Low quantity / High C:N') { bumpPriority('DOWN'); flags.push('Input-limited SOC gains'); }
    if (residue === 'Moderate quantity / Balanced C:N') { bumpPriority('UP'); flags.push('Optimal residue inputs for SOC formation'); }
    if (nutrient === 'Low / Imbalanced (C-rich, N/P/S limited)') { bumpPriority('DOWN'); bumpMRV('UP'); flags.push('Stoichiometric limitation → low CUE'); }
    if (nutrient === 'Balanced (stoichiometrically matched)') { bumpPriority('UP'); flags.push('Balanced nutrients → higher CUE'); }
  }

  // Texture (mostly affects feasibility / MRV burden)
  if (texture === 'Sandy') {
    if (pathway === 'RP-SOC') { bumpPriority('DOWN'); bumpMRV('UP'); flags.push('Lower SOC retention in sandy soils'); }
    if (pathway === 'ERW') { bumpPriority('DOWN'); flags.push('Lower contact time unless moisture maintained (sandy)'); }
  }
  if (texture === 'Clayey') {
    if (pathway === 'RP-SOC') bumpPriority('UP');
    if (pathway === 'AWD-CH₄') bumpPriority('UP'); // higher baseline, higher potential
    if (pathway === 'BIOCHAR') { bumpMRV('UP'); flags.push('Mixing / incorporation harder in clayey soils'); }
    if (pathway === 'ERW') bumpPriority('UP'); // moisture supports dissolution
  }

  // Materials (ERW)
  const react = get('Mineral Reactivity');
  const fine = get('Particle Size / Fineness');

  if (pathway === 'ERW') {
    if (react === 'Low (e.g. inert silicates)') { bumpPriority('DOWN'); flags.push('Low ERW CDR potential (low reactivity)'); }
    if (react === 'High (olivine-rich blends)') { bumpPriority('UP'); bumpMRV('UP'); flags.push('High kinetics / higher handling & verification needs'); }

    if (fine === 'Coarse') { bumpPriority('DOWN'); flags.push('Low surface area → slower dissolution (coarse)'); }
    if (fine === 'Fine') { bumpPriority('UP'); bumpMRV('UP'); flags.push('High kinetics but dust/handling evidence needed'); }
  }

  // -------------------------
  // 2) Optional: if no selections for this pathway at all -> CONDITIONAL
  // -------------------------
  const n = Object.keys(orderedSelections || {}).length;
  if (n === 0) eligibility = 'CONDITIONAL';

  // De-dup flags (clean output)
  const uniqFlags = [...new Set(flags)].slice(0, 8);

  return {
    eligibility,
    priority_impact,
    mrv_tier_impact: cpos_normMrvTierImpact_(mrv_tier_impact),
    flags: uniqFlags
  };
}

function evaluateCPOS_v2(selections, opts) {
  if (!selections || typeof selections !== 'object') throw new Error('evaluateCPOS_v2: selections missing');

  opts = opts || {};
  const noCache = opts.noCache === true;                 // ✅ preview mode
  const touchCache = opts.touchCache === true;           // optional: allow touch in preview
  const debug = opts.debug === true;                     // optional: return diagnostics

  // ✅ ensure CPOS_Rules is in "cache header" mode
  cpos_assertRulesCacheHeader_();

  const data = getCPOSData();
  const aspectsMap = data.aspectsMap || {};

  const results = {};
  CPOS_PATHWAYS.forEach(p => {
    results[p] = {
      eligibility: 'YES',
      priority: 'MEDIUM',
      mrv_tier: 'STANDARD',
      reasons: [],
      flags: [],
      final_text: '',
      mrv_variables: []
    };
  });

  // diagnostics
  let cacheHits = 0;
  let cacheTouches = 0;
  let cacheUpserts = 0;
  let computed = 0;

  CPOS_PATHWAYS.forEach(pathway => {
    const ordered = cpos_buildOrderedSelections_(pathway, selections, aspectsMap);
    const comboKey = cpos_buildComboKey_(pathway, CPOS_ORDER_VERSION, ordered);

    // ---------- Cache read ----------
    const cached = cpos_rulesCache_getByKey_(comboKey);
    if (cached && cpos_toBool_(cached.Is_Enabled) !== false) {
      cacheHits++;

      // Touch only if explicitly allowed (avoid inflating Use_Count during preview)
      if (!noCache || touchCache) {
        cpos_rulesCache_touch_(cached);
        cacheTouches++;
      }

      results[pathway] = cpos_cachedRow_toResult_(cached);
      return;
    }

    computed++;

    // ---------- Fail-fast gate ----------
    const gate = cpos_failFastGate_(pathway, ordered, selections);
    if (gate && gate.invalid) {
      const row = cpos_buildCacheRow_({
        comboKey, pathway, ordered,
        invalidReason: gate.reason,
        eligibilityImpact: gate.eligibility || 'NO',
        priorityImpact: 'NONE',
        mrvTierImpact: gate.mrv_tier_impact || 'NONE',
        flags: gate.flags || [],
        finalText: '',
        mrvVars: []
      });

      // ✅ Only write cache when NOT in noCache mode
      if (!noCache) {
        cpos_rulesCache_upsert_(row);
        cacheUpserts++;
      }

      results[pathway] = cpos_cachedRow_toResult_(row);
      return;
    }

    // ---------- Synthesis + impacts ----------
    const synth = cpos_synthesize_(pathway, ordered, aspectsMap);
    const impacts = cpos_deriveImpacts_(pathway, ordered, selections, synth);

    const row = cpos_buildCacheRow_({
      comboKey, pathway, ordered,
      invalidReason: '',
      eligibilityImpact: impacts.eligibility,
      priorityImpact: impacts.priority_impact,
      mrvTierImpact: impacts.mrv_tier_impact,
      flags: impacts.flags || [],
      finalText: synth.finalText,
      mrvVars: synth.mrvVars
    });

    // ✅ Only write cache when NOT in noCache mode
    if (!noCache) {
      cpos_rulesCache_upsert_(row);
      cacheUpserts++;
    }

    results[pathway] = cpos_cachedRow_toResult_(row);
  });

  const resp = { ok: true, selections, results, meta: { noCache } };

  if (debug) {
    resp.meta = {
      noCache,
      cacheHits,
      cacheTouches,
      cacheUpserts,
      computed
    };
  }

  return resp;
}




function cpos_upsertDraft_(p) {
  if (!p || !p.sessionId) throw new Error('Draft: sessionId missing');

  const sh = cpos_getSheet_('CPOS_Drafts');

  const values = sh.getDataRange().getValues();
  if (!values || !values.length) throw new Error('CPOS_Drafts: missing header row');

  const headers = values[0].map(h => String(h || '').trim());

  const idxSession = headers.indexOf('Session_ID');
  const idxUpdated = headers.indexOf('Updated_At');
  const idxSelJson = headers.indexOf('Selections_JSON');
  const idxSelHuman = headers.indexOf('Selections_Human');
  const idxCreated = headers.indexOf('Created_At');

  if (idxSession < 0 || idxUpdated < 0 || idxSelJson < 0) {
    throw new Error('CPOS_Drafts missing required headers: Session_ID, Updated_At, Selections_JSON');
  }

  const now = cpos_nowISO_();
  const selections = p.selections || {};
  const selJson = JSON.stringify(selections);
  const selHuman = Object.keys(selections).map(k => `${k}: ${selections[k]}`).join(' | ');

  // update existing
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][idxSession] || '') === String(p.sessionId)) {
      if (idxUpdated >= 0) sh.getRange(i + 1, idxUpdated + 1).setValue(now);
      if (idxSelJson >= 0) sh.getRange(i + 1, idxSelJson + 1).setValue(selJson);
      if (idxSelHuman >= 0) sh.getRange(i + 1, idxSelHuman + 1).setValue(selHuman);
      return { ok: true, updated: true };
    }
  }

  // append new
  const out = headers.map(h => {
    if (h === 'Draft_ID') return 'DRAFT-' + Utilities.getUuid();
    if (h === 'Session_ID') return String(p.sessionId);
    if (h === 'Created_At') return now;
    if (h === 'Updated_At') return now;
    if (h === 'Selections_JSON') return selJson;
    if (h === 'Selections_Human') return selHuman;
    return '';
  });

  sh.appendRow(out);
  return { ok: true, created: true };
}

//-------------START - NEW WEIGHTS and ZDESIRABILITY sheets implementation ------------

function cpos_tryGetSheet_(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(name);
}

function cpos_getTableFast_(sheetName) {
  const sh = cpos_getSheet_(sheetName);
  const values = sh.getDataRange().getValues();
  if (!values || values.length < 2) return { headers: [], rows: [] };

  const headers = values[0].map(h => String(h || '').trim());
  const rows = [];

  for (let i = 1; i < values.length; i++) {
    const r = values[i];
    let empty = true;
    const obj = {};
    for (let j = 0; j < headers.length; j++) {
      const h = headers[j];
      const v = r[j];
      if (v !== '' && v !== null && v !== undefined) empty = false;
      obj[h] = v;
    }
    if (!empty) rows.push(obj);
  }

  return { headers, rows };
}

function getCPOSData_Lite() {
  const boundsTbl = cpos_getTableFast_('CPOS_Lite_Bounds');
  const desirTbl  = cpos_getTableFast_('CPOS_Lite_Desirability');
  const wTbl      = cpos_getTableFast_('CPOS_Lite_Weights');

  // ---- Build aspectsMap from Bounds ----
  const aspectsMap = {}; 
  // aspectsMap[Variable_Name] = { category, classes:[], classOrder:{class->order}, factorId }
  boundsTbl.rows.forEach(r => {
    const a = String(r.Variable_Name || '').trim();
    const c = String(r.Class_Name || '').trim();
    if (!a || !c) return;

    if (!aspectsMap[a]) {
      aspectsMap[a] = {
        category: String(r.Factor_Category || '').trim(),
        factorId: String(r.Factor_ID || '').trim(),
        classes: [],
        classOrder: {}
      };
    }
    if (!aspectsMap[a].classes.includes(c)) aspectsMap[a].classes.push(c);

    const ord = Number(r.Class_Order);
    if (!isNaN(ord)) aspectsMap[a].classOrder[c] = ord;
  });

  Object.keys(aspectsMap).forEach(a => {
    // keep class order if available, else alphabetical
    const orderMap = aspectsMap[a].classOrder || {};
    aspectsMap[a].classes.sort((x,y) => {
      const ox = orderMap[x], oy = orderMap[y];
      if (ox !== undefined && oy !== undefined) return ox - oy;
      if (ox !== undefined) return -1;
      if (oy !== undefined) return 1;
      return x.localeCompare(y);
    });
  });

  // ---- Build desirability index ----
  // key: Variable_Name|Class_Name|Pathway -> desirability(0..1)
  const desirIdx = {};
  desirTbl.rows.forEach(r => {
    const a = String(r.Variable_Name || '').trim();
    const c = String(r.Class_Name || '').trim();
    const p = String(r.Pathway || '').trim();
    const d = Number(r.Desirability_0_1);
    if (!a || !c || !p || isNaN(d)) return;
    desirIdx[`${a}|${c}|${p}`] = Math.max(0, Math.min(1, d));
  });

  // ---- Build weights index ----
  // key: Variable_Name|Pathway -> weight(0..10)
  const wIdx = {};
  wTbl.rows.forEach(r => {
    const a = String(r.Variable_Name || '').trim();
    const p = String(r.Pathway || '').trim();
    const w = Number(r.Sensitivity_Weight_0_10);
    if (!a || !p || isNaN(w)) return;
    wIdx[`${a}|${p}`] = Math.max(0, Math.min(10, w));
  });

  return {
    ok: true,
    aspectsMap,
    desirIdx,
    wIdx
  };
}


function cpos_rulesCache_buildIndex_() {
  cpos_assertRulesCacheHeader_();
  const sh = cpos_getSheet_('CPOS_Rules');
  const values = sh.getDataRange().getValues();
  const headers = values[0].map(h => String(h||'').trim());

  const idx = {};
  headers.forEach((h,i)=>idx[h]=i);

  const keyCol = idx.Combo_Key;
  if (keyCol === undefined) throw new Error('CPOS_Rules missing Combo_Key');

  const map = {}; // comboKey -> sheetRowNumber
  for (let r = 1; r < values.length; r++) {
    const k = String(values[r][keyCol] || '').trim();
    if (k) map[k] = r + 1; // sheet row
  }

  return { sh, values, headers, idx, map };
}

function cpos_rulesCache_getByKeyFast_(cache, comboKey) {
  const rowNum = cache.map[String(comboKey||'').trim()];
  if (!rowNum) return null;

  const r = rowNum - 1; // values index
  const obj = {};
  cache.headers.forEach((h,i)=>obj[h]=cache.values[r][i]);
  obj.__row = rowNum;
  return obj;
}

function cpos_rulesCache_touchFast_(cache, rowObj) {
  const row = rowObj.__row;
  if (!row) return;

  const idxLast = cache.idx.Last_Used_At;
  const idxCount = cache.idx.Use_Count;

  const now = cpos_nowISO_();
  if (idxLast !== undefined) cache.sh.getRange(row, idxLast+1).setValue(now);

  if (idxCount !== undefined) {
    const cur = Number(rowObj.Use_Count || 0);
    cache.sh.getRange(row, idxCount+1).setValue(cur + 1);
  }
}

function evaluateCPOS_Lite_v1(selections, opts) {
  if (!selections || typeof selections !== 'object') throw new Error('evaluateCPOS_Lite_v1: selections missing');
  opts = opts || {};

  const debug = opts.debug === true;
  const noCache = opts.noCache === true;
  const touchCache = opts.touchCache === true;

  const data = getCPOSData_Lite();
  const aspectsMap = data.aspectsMap || {};
  const desirIdx = data.desirIdx || {};
  const wIdx = data.wIdx || {};

  // cache index (only needed when not in noCache mode)
  const cache = (!noCache) ? cpos_rulesCache_buildIndex_() : null;

  const results = {};
  CPOS_PATHWAYS.forEach(p => {
    results[p] = {
      eligibility: 'YES',
      priority: 'MEDIUM',
      mrv_tier: 'STANDARD',
      reasons: [],
      flags: [],
      final_text: '',
      mrv_variables: []
    };
  });

  const meta = { noCache, cacheHits:0, cacheTouches:0, cacheUpserts:0, computed:0 };

  CPOS_PATHWAYS.forEach(pathwayKey => {
    const pathwayName = CPOS_LITE_PATHWAY_MAP[pathwayKey] || pathwayKey;

    // ordered selections still useful for deterministic cache key
    const ordered = cpos_buildOrderedSelections_(pathwayKey, selections, aspectsMap);
    const comboKey = cpos_buildComboKey_(pathwayKey, CPOS_ORDER_VERSION, ordered);

    // ---------- Cache read ----------
    if (!noCache) {
      const hit = cpos_rulesCache_getByKeyFast_(cache, comboKey);
      if (hit && cpos_toBool_(hit.Is_Enabled) !== false) {
        meta.cacheHits++;
        if (touchCache) {
          cpos_rulesCache_touchFast_(cache, hit);
          meta.cacheTouches++;
        }
        results[pathwayKey] = cpos_cachedRow_toResult_(hit);
        return;
      }
    }

    meta.computed++;

    // ---------- Scoring ----------
    let num = 0;
    let den = 0;
    const contributions = []; // for explainability

    Object.keys(ordered).forEach(aspect => {
      const cls = String(ordered[aspect] || '').trim();
      if (!cls) return;

      const w = Number(wIdx[`${aspect}|${pathwayName}`] || 0);
      if (!w) return; // missing or zero relevance

      const d = Number(desirIdx[`${aspect}|${cls}|${pathwayName}`]);
      if (isNaN(d)) return;

      num += (w * d);
      den += w;

      contributions.push({ aspect, cls, w, d, wd: w*d });
    });

    const score = (den > 0) ? (100 * (num / den)) : 0;

    // ---------- Simple tier mapping (you can tune) ----------
    let eligibility = (den > 0) ? 'YES' : 'CONDITIONAL';
    let priority = (score >= 70) ? 'HIGH' : (score >= 45 ? 'MEDIUM' : 'LOW');

    // MRV burden proxy: if many mid desirability + high weights -> higher MRV
    const highW = contributions.filter(x => x.w >= 7).length;
    let mrv_tier = (highW >= 4) ? 'HIGH' : (highW >= 2 ? 'STANDARD' : 'LIGHT');

    // ---------- Explanations ----------
    contributions.sort((a,b)=> (b.wd - a.wd));

    const topPos = contributions.slice(0, 3)
      .map(x => `${x.aspect}: ${x.cls} (w=${x.w}, d=${x.d})`);

    const reasons = [];
    reasons.push(`Score = ${score.toFixed(1)} / 100 (normalized).`);
    if (priority === 'HIGH') reasons.push('High suitability under current factor context.');
    else if (priority === 'LOW') reasons.push('Low suitability under current factor context.');
    else reasons.push('Moderate suitability under current factor context.');

    if (topPos.length) reasons.push('Top drivers: ' + topPos.join(' | '));

    // Build final_text as a concise explainable paragraph
    const final_text =
      `Normalized suitability score is ${score.toFixed(1)}/100 using dynamic weight normalization. ` +
      (topPos.length ? (`Key drivers: ${topPos.join('; ')}.`) : '');

    // Build cache row + write if allowed
    const row = cpos_buildCacheRow_({
      comboKey, pathway: pathwayKey, ordered,
      invalidReason: '',
      eligibilityImpact: eligibility,
      priorityImpact: (priority === 'HIGH') ? 'UP' : (priority === 'LOW' ? 'DOWN' : 'NONE'),
      mrvTierImpact: (mrv_tier === 'HIGH') ? 'HIGH' : (mrv_tier === 'LIGHT' ? 'LIGHT' : 'STANDARD'),
      flags: [],
      finalText: final_text,
      mrvVars: [] // you can populate later from a column if you add MRV vars table
    });

    if (!noCache) {
      cpos_rulesCache_upsert_(row);
      meta.cacheUpserts++;
    }

    // Return in existing UI shape
    results[pathwayKey] = {
      eligibility,
      priority,
      mrv_tier,
      reasons: reasons.slice(0, 4),
      flags: [],
      final_text,
      mrv_variables: []
    };
  });

  const resp = { ok:true, selections, results, meta: { noCache } };
  if (debug) resp.meta = meta;
  return resp;
}

//-------------END - NEW WEIGHTS and ZDESIRABILITY sheets implementation ------------

/** =========================================================
 * FRONTEND COMPAT WRAPPERS (keep UI unchanged)
 * - Frontend calls getCPOSData_Lite() and evaluateCPOS_Lite_v1()
 * ========================================================= */

function getCPOSData_Lite() {
  // Return the structure the frontend expects:
  // { ok, aspectsMap, desirIdx, wIdx, rules }
  const base = getCPOSData({ includeRules: false }) || {};
  const aspectsMap = base.aspectsMap || {};

  // Build desirIdx + wIdx from CPOS_Classes (robust header detection)
  const tbl = cpos_getTable_('CPOS_Classes');
  const headers = (tbl.headers || []).map(h => String(h || '').trim());
  const rows = (tbl.rows || []).filter(r => cpos_toBool_(r.Is_Enabled) !== false);

  // Frontend uses p.backend names:
  // 'Regenerative Ag', 'AWD', 'Biochar', 'ERW'
  const P_BACKEND = ['Regenerative Ag', 'AWD', 'Biochar', 'ERW'];

  // Helper: find a column name by candidates (first hit wins)
  function pickCol_(cands) {
    for (const c of cands) if (headers.includes(c)) return c;
    return '';
  }

  // Try common column naming patterns (edit these once you confirm your CPOS_Classes headers)
  const COLMAP = {
    'Regenerative Ag': {
      w: pickCol_(['Weight_Regenerative Ag', 'W_Regenerative Ag', 'Weight_RP-SOC', 'W_RP-SOC', 'Weight_RP_SOC', 'W_RP_SOC', 'RP_SOC_Weight']),
      d: pickCol_(['Desirability_Regenerative Ag', 'D_Regenerative Ag', 'Desirability_RP-SOC', 'D_RP-SOC', 'Desirability_RP_SOC', 'D_RP_SOC', 'RP_SOC_Desirability'])
    },
    'AWD': {
      w: pickCol_(['Weight_AWD', 'W_AWD', 'Weight_AWD-CH4', 'W_AWD-CH4', 'AWD_Weight']),
      d: pickCol_(['Desirability_AWD', 'D_AWD', 'Desirability_AWD-CH4', 'D_AWD-CH4', 'AWD_Desirability'])
    },
    'Biochar': {
      w: pickCol_(['Weight_Biochar', 'W_Biochar', 'BIOCHAR_Weight']),
      d: pickCol_(['Desirability_Biochar', 'D_Biochar', 'BIOCHAR_Desirability'])
    },
    'ERW': {
      w: pickCol_(['Weight_ERW', 'W_ERW', 'ERW_Weight']),
      d: pickCol_(['Desirability_ERW', 'D_ERW', 'ERW_Desirability'])
    }
  };

  const wIdx = {};
  const desirIdx = {};

  rows.forEach(r => {
    const aspect = String(r.Aspect || '').trim();
    const cls = String(r.Class || '').trim();
    if (!aspect || !cls) return;

    P_BACKEND.forEach(p => {
      const wCol = (COLMAP[p] && COLMAP[p].w) ? COLMAP[p].w : '';
      const dCol = (COLMAP[p] && COLMAP[p].d) ? COLMAP[p].d : '';

      const w = wCol ? Number(r[wCol]) : 0;
      const d = dCol ? Number(r[dCol]) : NaN;

      // Frontend keys:
      // wIdx["Aspect|BackendName"]
      // desirIdx["Aspect|Class|BackendName"]
      wIdx[`${aspect}|${p}`] = Number.isFinite(w) ? w : 0;
      if (Number.isFinite(d)) desirIdx[`${aspect}|${cls}|${p}`] = d;
    });
  });

  return {
    ok: true,
    aspectsMap,
    rules: [],      // lite mode doesn’t need legacy v1 rules
    wIdx,
    desirIdx
  };
}

function evaluateCPOS_Lite_v1(selections, opts) {
  // Frontend expects { ok, selections, results, meta? }
  return evaluateCPOS_v2(selections, opts || {});
}

//------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
//-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
//-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------



function TEST_getCPOSData() {
  const d = getCPOSData();
  Logger.log('ok=' + d.ok);
  Logger.log('aspects=' + Object.keys(d.aspectsMap || {}).length);
  Logger.log('rules=' + (d.rules || []).length);
}


function TEST_eval_v2() {
  const selections = {
    'Crop Type': 'Rice (flooded)',
    'Water Management Intensity': 'AWD (intermittent drying)',
    'Drainage Class': 'Moderately / Imperfectly drained'
  };
  const res = evaluateCPOS_v2(selections, { noCache: true, debug: true });
  Logger.log(JSON.stringify(res.meta, null, 2));
  Logger.log(JSON.stringify(res.results['AWD-CH₄'], null, 2));
}

function TEST_eval_v2_cacheWriteThenHit() {
  const selections = {
    'Crop Type': 'Rice (flooded)',
    'Water Management Intensity': 'AWD (intermittent drying)',
    'Drainage Class': 'Moderately / Imperfectly drained'
  };

  // 1) First run -> should COMPUTE + UPSERT rows into CPOS_Rules
  const r1 = evaluateCPOS_v2(selections, { noCache: false, debug: true });
  Logger.log('RUN1_META=' + JSON.stringify(r1.meta, null, 2));

  // 2) Second run -> should HIT cache (no compute), and TOUCH (use_count / last_used)
  const r2 = evaluateCPOS_v2(selections, { noCache: false, debug: true });
  Logger.log('RUN2_META=' + JSON.stringify(r2.meta, null, 2));
}


function test_cacheIndex_perf() {
  const selections = {
    'Crop Type': 'Rice (flooded)',
    'Water Management Intensity': 'AWD (intermittent drying)',
    'Drainage Class': 'Moderately / Imperfectly drained',
    'Operational / Irrigation Control': 'High (controlled irrigation)'
  };

  const t0 = Date.now();
  const r1 = evaluateCPOS_v2(selections, { noCache: false, debug: true });
  const t1 = Date.now();
  Logger.log('RUN1_ms=' + (t1 - t0));
  Logger.log('RUN1_meta=' + JSON.stringify(r1.meta, null, 2));

  const r2 = evaluateCPOS_v2(selections, { noCache: false, debug: true });
  const t2 = Date.now();
  Logger.log('RUN2_ms=' + (t2 - t1));
  Logger.log('RUN2_meta=' + JSON.stringify(r2.meta, null, 2));
}
