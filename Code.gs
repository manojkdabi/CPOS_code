/***********************
 * CP-OS Lite Backend (DROP-IN)
 * ✅ Uses ONLY:
 *   - CPOS_Lite_Bounds
 *   - CPOS_Lite_Desirability
 *   - CPOS_Lite_Weights
 *
 * ❌ Does NOT read:
 *   - CPOS_Classes
 *   - CPOS_Rules
 *
 * Public API preserved:
 * - doGet()
 * - getCPOSData()           -> lite payload
 * - getCPOSData_Lite()      -> lite payload
 * - evaluateCPOS_v2()       -> delegates to lite evaluator
 * - evaluateCPOS_Lite_v1()  -> lite evaluator
 * - saveCPOSAssessment()
 * - cpos_upsertDraft()
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

// ✅ Server API for frontend boot
function getCPOSLiteTables() {
  const bounds = cpos_getTableFast_('CPOS_Lite_Bounds');
  const desir  = cpos_getTableFast_('CPOS_Lite_Desirability');
  const wts    = cpos_getTableFast_('CPOS_Lite_Weights');

  // optional computed maps (you already have this)
  const lite = getCPOSData_Lite();

  return {
    ok: true,
    // raw rows for frontend indexing
    bounds: bounds.rows || [],
    desirability: desir.rows || [],
    weights: wts.rows || [],

    // optional computed
    aspectsMap: lite.aspectsMap || {},
    desirIdx: lite.desirIdx || {},
    wIdx: lite.wIdx || {}
  };
}

// ✅ Back-compat alias used by frontend
function saveCPOSLiteAssessment(payload) {
  return saveCPOSAssessment(payload);
}



function cpos_getSheet_(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(name);
  if (!sh) throw new Error(`Missing sheet: ${name}`);
  return sh;
}

function cpos_tryGetSheet_(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(name) || null;
}

function cpos_nowISO_() {
  return new Date().toISOString();
}

function cpos_toBool_(v, defaultValue) {
  if (v === '' || v === null || v === undefined) {
    return (defaultValue === undefined) ? true : !!defaultValue;
  }
  if (typeof v === 'boolean') return v;
  const s = String(v).trim().toLowerCase();
  if (s === 'true' || s === 'yes' || s === '1') return true;
  if (s === 'false' || s === 'no' || s === '0') return false;
  return (defaultValue === undefined) ? true : !!defaultValue;
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

/** ---------- Constants (Lite) ---------- */

// Frontend results keys (keep your established keys)
const CPOS_PATHWAYS = ['RP-SOC', 'AWD-CH₄', 'BIOCHAR', 'ERW'];

// Normalize pathway labels coming from Lite tables (Pathway column)
// (Supports your likely variants)
const CPOS_PATHWAY_ALIAS = {
  'rp-soc': 'RP-SOC',
  'rp soc': 'RP-SOC',
  'regenerative ag': 'RP-SOC',
  'regenerative agriculture': 'RP-SOC',
  'awd': 'AWD-CH₄',
  'awd-ch4': 'AWD-CH₄',
  'awd-ch₄': 'AWD-CH₄',
  'biochar': 'BIOCHAR',
  'erw': 'ERW'
};

function cpos_normPathway_(p) {
  const k = String(p || '').trim().toLowerCase();
  return CPOS_PATHWAY_ALIAS[k] || String(p || '').trim();
}

function cpos_normKey_(s) {
  return String(s || '')
    .trim()
    .replace(/\u00A0/g, ' ')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ');
}

/** =========================================================
 * PUBLIC: Lite data for dropdowns + scoring indices
 * Returns:
 *  {
 *    ok: true,
 *    aspectsMap: {
 *      "<Variable_Name>": { category, factorId, classes:[...], classOrder:{...} }
 *    },
 *    desirIdx: { "Var|Class|Pathway": 0..1 },
 *    wIdx:     { "Var|Pathway": 0..10 }
 *  }
 * ========================================================= */
function getCPOSData_Lite() {
  const boundsTbl = cpos_getTableFast_('CPOS_Lite_Bounds');
  const desirTbl  = cpos_getTableFast_('CPOS_Lite_Desirability');
  const wTbl      = cpos_getTableFast_('CPOS_Lite_Weights');

  // ---- aspectsMap from Bounds ----
  const aspectsMap = {};
  boundsTbl.rows.forEach(r => {
    const a = cpos_normKey_(r.Variable_Name);
    const c = cpos_normKey_(r.Class_Name);
    if (!a || !c) return;

    if (!aspectsMap[a]) {
      aspectsMap[a] = {
        category: cpos_normKey_(r.Factor_Category),
        factorId: cpos_normKey_(r.Factor_ID),
        classes: [],
        classOrder: {}
      };
    }

    if (!aspectsMap[a].classes.includes(c)) aspectsMap[a].classes.push(c);

    const ord = Number(r.Class_Order);
    if (!isNaN(ord)) aspectsMap[a].classOrder[c] = ord;
  });

  // Sort classes by Class_Order if present, else alpha
  Object.keys(aspectsMap).forEach(a => {
    const orderMap = aspectsMap[a].classOrder || {};
    aspectsMap[a].classes.sort((x, y) => {
      const ox = orderMap[x], oy = orderMap[y];
      if (ox !== undefined && oy !== undefined) return ox - oy;
      if (ox !== undefined) return -1;
      if (oy !== undefined) return 1;
      return String(x).localeCompare(String(y));
    });
  });

  // ---- desirability index ----
  // key: Variable_Name|Class_Name|Pathway -> desirability(0..1)
  const desirIdx = {};
  desirTbl.rows.forEach(r => {
    const a = cpos_normKey_(r.Variable_Name);
    const c = cpos_normKey_(r.Class_Name);
    const p = cpos_normPathway_(r.Pathway);

    const d = Number(r.Desirability_0_1);
    if (!a || !c || !p || isNaN(d)) return;

    desirIdx[`${a}|${c}|${p}`] = Math.max(0, Math.min(1, d));
  });

  // ---- weights index ----
  // key: Variable_Name|Pathway -> weight(0..10)
  const wIdx = {};
  wTbl.rows.forEach(r => {
    const a = cpos_normKey_(r.Variable_Name);
    const p = cpos_normPathway_(r.Pathway);

    const w = Number(r.Sensitivity_Weight_0_10);
    if (!a || !p || isNaN(w)) return;

    wIdx[`${a}|${p}`] = Math.max(0, Math.min(10, w));
  });

  return { ok: true, aspectsMap, desirIdx, wIdx };
}

/**
 * Back-compat wrapper:
 * Some frontends still call getCPOSData() and expect {ok, aspectsMap, rules?}
 * We return lite payload + rules:[]
 */
function getCPOSData(opts) {
  const lite = getCPOSData_Lite();
  return {
    ok: true,
    aspectsMap: lite.aspectsMap || {},
    desirIdx: lite.desirIdx || {},
    wIdx: lite.wIdx || {},
    rules: [] // legacy placeholder
  };
}

/** =========================================================
 * PUBLIC: Lite evaluation
 * selections: { "<Variable_Name>": "<Class_Name>", ... }
 *
 * Returns:
 * { ok:true, selections, results, meta }
 * ========================================================= */
function evaluateCPOS_Lite_v1(selections, opts) {
  if (!selections || typeof selections !== 'object') {
    throw new Error('evaluateCPOS_Lite_v1: selections missing');
  }

  opts = opts || {};
  const debug = opts.debug === true;

  const data = getCPOSData_Lite();
  const desirIdx = data.desirIdx || {};
  const wIdx = data.wIdx || {};

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

  const meta = { computed: 0 };

  // Evaluate each pathway independently
  CPOS_PATHWAYS.forEach(pathway => {
    meta.computed++;

    let num = 0;
    let den = 0;
    const contributions = [];

    Object.keys(selections).forEach(varNameRaw => {
      const varName = cpos_normKey_(varNameRaw);
      const cls = cpos_normKey_(selections[varNameRaw]);

      if (!varName || !cls) return;

      const w = Number(wIdx[`${varName}|${pathway}`] || 0);
      if (!w) return;

      const d = Number(desirIdx[`${varName}|${cls}|${pathway}`]);
      if (isNaN(d)) return;

      num += (w * d);
      den += w;

      contributions.push({ varName, cls, w, d, wd: (w * d) });
    });

    // Normalized score
    const score = (den > 0) ? (100 * (num / den)) : 0;

    // Eligibility
    const eligibility = (den > 0) ? 'YES' : 'CONDITIONAL';

    // Priority banding (tune if you want)
    let priority = 'MEDIUM';
    if (eligibility === 'CONDITIONAL') priority = 'LOW';
    else if (score >= 70) priority = 'HIGH';
    else if (score < 45) priority = 'LOW';

    // MRV tier proxy: count high-importance drivers used
    const highW = contributions.filter(x => x.w >= 7).length;
    let mrv_tier = 'STANDARD';
    if (eligibility === 'CONDITIONAL') mrv_tier = 'HIGH';
    else if (highW >= 4) mrv_tier = 'HIGH';
    else if (highW <= 1) mrv_tier = 'LIGHT';

    // Explanations
    contributions.sort((a, b) => (b.wd - a.wd));
    const top = contributions.slice(0, 3);

    const reasons = [];
    reasons.push(`Score = ${score.toFixed(1)} / 100 (normalized).`);
    if (priority === 'HIGH') reasons.push('High suitability under current factor context.');
    else if (priority === 'LOW') reasons.push('Low suitability under current factor context.');
    else reasons.push('Moderate suitability under current factor context.');

    if (top.length) {
      reasons.push('Top drivers: ' + top.map(x => `${x.varName}: ${x.cls} (w=${x.w}, d=${x.d})`).join(' | '));
    }

    const final_text =
      `Normalized suitability score is ${score.toFixed(1)}/100 using weights (0–10) and desirability (0–1). ` +
      (top.length ? (`Key drivers: ${top.map(x => `${x.varName}=${x.cls}`).join('; ')}.`) : '');

    results[pathway] = {
      eligibility,
      priority,
      mrv_tier,
      reasons: reasons.slice(0, 4),
      flags: [],
      final_text,
      mrv_variables: []
    };
  });

  const resp = { ok: true, selections, results };
  if (debug) resp.meta = meta;
  return resp;
}

/**
 * Back-compat wrapper:
 * If your frontend still calls evaluateCPOS_v2(), keep it working.
 */
function evaluateCPOS_v2(selections, opts) {
  return evaluateCPOS_Lite_v1(selections, opts || {});
}

/** =========================================================
 * Save assessment (unchanged)
 * payload = { clientId, siteId, siteName, lat, lon, cropSystem, state, district, selections, results, notes }
 * ========================================================= */
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

  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(h => String(h || '').trim());
  const out = headers.map(h => row[h] !== undefined ? row[h] : '');
  sh.appendRow(out);

  return { ok: true, Assessment_ID: assessmentId };
}

/** =========================================================
 * Draft upsert (unchanged)
 * ========================================================= */
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



/**
 * PUBLIC: getCPOSQuestionnaireConfig()
 * Returns questionnaire config + Bounds classes for mapping validation.
 */
function getCPOSQuestionnaireConfig() {
  const bank   = cpos_getTableFast_('CPOS_Q_Bank');
  const opts   = cpos_getTableFast_('CPOS_Q_Options');
  const deriv  = cpos_getTableFast_('CPOS_Q_Derivation_Rules');
  const routes = cpos_getTableFast_('CPOS_Q_Routing_Rules');
  const map    = cpos_getTableFast_('CPOS_Q_Signal_to_LiteFactor_Map');

  // Lite bounds for validation + UI units/class lists
  const bounds = cpos_getTableFast_('CPOS_Lite_Bounds');

  return {
    ok: true,
    bank: bank.rows || [],
    options: opts.rows || [],
    derivationRules: deriv.rows || [],
    routingRules: routes.rows || [],
    signalToLiteMap: map.rows || [],
    liteBounds: bounds.rows || []
  };
}


/**
 * PUBLIC: saveCPOSQuestionnaireSession(payload)
 * payload = {
 *   session: { Session_ID?, Client_ID?, Site_ID?, Site_Name?, Mode?, Min_Q_Target?, Max_Q_Cap?, Status? },
 *   responses: [ { Question_ID, Answer_Raw, Answer_Normalized?, Derived_Signals_JSON? } ],
 *   signals:   [ { Signal_Key, Signal_Value, Confidence?, Source? } ],
 *   summary:   { ... }   // optional
 * }
 */
function saveCPOSQuestionnaireSession(payload) {
  payload = payload || {};
  const now = cpos_nowISO_();
  const user = Session.getActiveUser().getEmail() || 'unknown';

  const sess = payload.session || {};
  const sessionId = sess.Session_ID || ('Q-' + Utilities.getUuid().slice(0, 10).toUpperCase());
  const version = sess.Version || payload.version || 'v1';

  // --- upsert session ---
  const shS = cpos_getSheet_('CPOS_Q_Sessions');
  const sVals = shS.getDataRange().getValues();
  if (!sVals || !sVals.length) throw new Error('CPOS_Q_Sessions: missing header row');
  const sHdr = sVals[0].map(h => String(h||'').trim());
  const idxSid = sHdr.indexOf('Session_ID');
  if (idxSid < 0) throw new Error('CPOS_Q_Sessions: missing Session_ID');

  const rowObj = {
    Session_ID: sessionId,
    Created_At: sess.Created_At || now,
    Created_By: sess.Created_By || user,
    Client_ID: sess.Client_ID || 'Default',
    Site_ID: sess.Site_ID || '',
    Site_Name: sess.Site_Name || '',
    Mode: sess.Mode || 'BASIC',
    Min_Target: sess.Min_Target || 20,
    Max_Cap: sess.Max_Cap || 50,
    Answered_Count: sess.Answered_Count || (payload.responses ? payload.responses.length : 0),
    Status: sess.Status || 'COMPLETED',
    Summary_JSON: JSON.stringify(payload.summary || {}),
    Version: version
  };

  let updated = false;
  for (let i = 1; i < sVals.length; i++) {
    if (String(sVals[i][idxSid]||'') === String(sessionId)) {
      const out = sHdr.map(h => rowObj[h] !== undefined ? rowObj[h] : sVals[i][sHdr.indexOf(h)]);
      shS.getRange(i+1, 1, 1, sHdr.length).setValues([out]);
      updated = true;
      break;
    }
  }
  if (!updated) {
    shS.appendRow(sHdr.map(h => rowObj[h] !== undefined ? rowObj[h] : ''));
  }

  // --- append responses ---
  const shR = cpos_getSheet_('CPOS_Q_Responses');
  const rHdr = shR.getRange(1,1,1,shR.getLastColumn()).getValues()[0].map(h => String(h||'').trim());

  const resp = Array.isArray(payload.responses) ? payload.responses : [];
  if (resp.length) {
    const rows = resp.map(r => {
      const rr = {
        Session_ID: sessionId,
        Answered_At: now,
        Question_ID: r.Question_ID || '',
        Answer_Raw: r.Answer_Raw !== undefined ? String(r.Answer_Raw) : '',
        Answer_Codes: r.Answer_Codes ? String(r.Answer_Codes) : '',
        Derived_Signals_JSON: r.Derived_Signals_JSON ? String(r.Derived_Signals_JSON) : '',
        Version: version
      };
      return rHdr.map(h => rr[h] !== undefined ? rr[h] : '');
    });

    shR.getRange(shR.getLastRow()+1, 1, rows.length, rHdr.length).setValues(rows);
  }

  return { ok: true, Session_ID: sessionId, updated };
}



/** =========================================================
 * Quick tests
 * ========================================================= */
function TEST_LITE_getData() {
  const d = getCPOSData_Lite();
  Logger.log('ok=' + d.ok);
  Logger.log('vars=' + Object.keys(d.aspectsMap || {}).length);
  Logger.log('desir keys=' + Object.keys(d.desirIdx || {}).length);
  Logger.log('w keys=' + Object.keys(d.wIdx || {}).length);
}

function TEST_LITE_eval() {
  const selections = {
    'Crop Type': 'Rice (flooded)',
    'Water Management Intensity': 'AWD (intermittent drying)',
    'Drainage Class': 'Moderately / Imperfectly drained'
  };
  const r = evaluateCPOS_Lite_v1(selections, { debug: true });
  Logger.log(JSON.stringify(r, null, 2));
}

