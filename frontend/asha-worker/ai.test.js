/* Node unit tests for the offline AI engine (ai.js) + translation
 * completeness (ai-i18n.js). Run with:  node --test frontend/asha-worker
 * (Node >= 18; uses the built-in node:test runner).
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const AI = require('./ai.js');
const I18N = require('./ai-i18n.js');

/* ------------------------------------------------------------------ */
/* Voice keyword detection                                             */
/* ------------------------------------------------------------------ */
test('detect latin-script Hindi keywords (bukhar + khansi)', () => {
  const r = AI.detectFromTranscript('mujhe bukhar aur khansi hai');
  assert.equal(r.symptoms.high_fever, true);
  assert.equal(r.symptoms.cough_cold, true);
});

test('detect Devanagari keywords', () => {
  const r = AI.detectFromTranscript('मुझे बुखार है और खांसी भी आ रही है');
  assert.equal(r.symptoms.high_fever, true);
  assert.equal(r.symptoms.cough_cold, true);
});

test('detect english chest pain', () => {
  const r = AI.detectFromTranscript('he has chest pain since morning');
  assert.equal(r.symptoms.chest_pain, true);
});

test('single-word keywords use word boundaries (no false positives)', () => {
  assert.equal(AI.detectFromTranscript('dastavej dikhao').symptoms.diarrhea, undefined);
  assert.equal(AI.detectFromTranscript('dast lag rahe hai').symptoms.diarrhea, true);
  assert.equal(AI.detectFromTranscript('shift me kaam karta hai').symptoms.severe_headache, undefined);
});

test('empty / junk transcripts detect nothing', () => {
  assert.deepEqual(AI.detectFromTranscript('').found, []);
  assert.deepEqual(AI.detectFromTranscript('namaste duniya').found, []);
});

test('urinary complaint is now recognised (the reported phrase)', () => {
  const r = AI.detectFromTranscript('mere ko bahut Tej peshab a rahi hai per mujhe peshab nahi hoti');
  assert.equal(r.symptoms.urination_problem, true);
  const dev = AI.detectFromTranscript('मुझे बार-बार पेशाब आ रही है और जलन है');
  assert.equal(dev.symptoms.urination_problem, true);
});

test('new common problems are detected by voice keywords', () => {
  const cases = [
    ['mujhe gale me dard hai', 'sore_throat'],
    ['ghutno me bahut dard', 'joint_pain'],
    ['kamar me dard hai', 'back_pain'],
    ['puri body par khujli ho rahi hai', 'skin_rash'],
    ['aankh me dard aur paani', 'eye_problem'],
    ['kaan me dard hai', 'ear_pain'],
    ['mujhe chakkar aa rahe hain', 'dizziness'],
    ['pet me jalan aur gas', 'acidity'],
    ['tino din se kabj hai', 'constipation'],
    ['daant me bahut dard', 'toothache'],
    ['mera haath sunn ho gaya', 'numbness'],
    ['pair me sujan aa gayi', 'swelling'],
  ];
  for (const [text, key] of cases) {
    assert.equal(AI.detectFromTranscript(text).symptoms[key], true, text);
  }
});

test('new common problems produce advisory suggestions', () => {
  const y = AI.generateSuggestions(pd({ symptoms: { urination_problem: true } }));
  assert.ok(y.find((s) => s.priority === 'YELLOW' && s.id === 'urinary'));
  assert.ok(AI.generateSuggestions(pd({ symptoms: { numbness: true } }))
    .find((s) => s.priority === 'YELLOW' && s.id === 'numbness'));
  assert.ok(AI.generateSuggestions(pd({ symptoms: { dizziness: true } }))
    .find((s) => s.priority === 'YELLOW' && s.id === 'dizzy'));
  assert.ok(AI.generateSuggestions(pd({ symptoms: { swelling: true } }))
    .find((s) => s.priority === 'YELLOW' && s.id === 'swelling'));
  const g = AI.generateSuggestions(pd({ symptoms: { sore_throat: true } }));
  assert.ok(g.length === 1 && g[0].priority === 'GREEN' && g[0].id === 'sore_throat');
  const g2 = AI.generateSuggestions(pd({ symptoms: { toothache: true, back_pain: true } }));
  assert.ok(g2.length === 2 && g2.every((s) => s.priority === 'GREEN'));
});

/* ------------------------------------------------------------------ */
/* Clinical suggestion scenarios (from the feature spec)               */
/* ------------------------------------------------------------------ */
function pd(overrides) {
  return Object.assign({ symptoms: {}, vitals: {}, history: {} }, overrides);
}

test('Scenario 1: chest pain + BP 185/110 -> RED heart protocol', () => {
  const list = AI.generateSuggestions(pd({
    symptoms: { chest_pain: true },
    vitals: { systolic_bp: 185, diastolic_bp: 110 },
  }));
  const red = list.filter((s) => s.priority === 'RED');
  assert.ok(red.some((s) => s.id === 'chest_pain'), 'chest_pain RED rule fires');
  assert.ok(red.some((s) => s.id === 'bp_very_high'), 'bp_very_high RED rule fires');
  const chest = red.find((s) => s.id === 'chest_pain');
  assert.ok(chest.acts.includes('ai.act.call108'), 'call108 action present');
});

test('Scenario 2: unconscious -> RED with CPR + recovery actions', () => {
  const list = AI.generateSuggestions(pd({ symptoms: { unconscious: true } }));
  const u = list.find((s) => s.priority === 'RED' && s.id === 'unconscious');
  assert.ok(u);
  assert.ok(u.acts.includes('ai.act.cpr'));
  assert.ok(u.acts.includes('ai.act.recovery_pos'));
  assert.ok(u.acts.includes('ai.act.call108'));
});

test('Scenario 3: temp 100.5F (38.1C) + cough -> GREEN only', () => {
  const list = AI.generateSuggestions(pd({
    symptoms: { cough_cold: true },
    vitals: { temperature: 38.1 },
  }));
  assert.equal(list.filter((s) => s.priority === 'RED').length, 0);
  assert.equal(list.filter((s) => s.priority === 'YELLOW').length, 0);
  const greens = list.map((s) => s.id);
  assert.ok(greens.includes('mild_fever'));
  assert.ok(greens.includes('cough'));
});

test('Scenario 4: pregnant + severe headache + BP 150/95 -> YELLOW pre-eclampsia', () => {
  const list = AI.generateSuggestions(pd({
    symptoms: { severe_headache: true },
    vitals: { systolic_bp: 150, diastolic_bp: 95 },
    history: { pregnant: true },
  }));
  const y = list.find((s) => s.priority === 'YELLOW' && s.id === 'preeclampsia');
  assert.ok(y, 'pre-eclampsia YELLOW rule fires');
  assert.ok(y.acts.includes('ai.act.left_side'));
  assert.ok(y.acts.includes('ai.act.no_meds_preg'));
});

test('hypoxia: SpO2 88 -> RED oxygen rule', () => {
  const list = AI.generateSuggestions(pd({ vitals: { spo2: 88 } }));
  const s = list.find((x) => x.priority === 'RED' && x.id === 'spo2');
  assert.ok(s);
  assert.deepEqual(s.titleVars, [88]);
});

test('severe bleeding -> RED bleeding rule', () => {
  const list = AI.generateSuggestions(pd({ symptoms: { severe_bleeding: true } }));
  assert.ok(list.find((x) => x.priority === 'RED' && x.id === 'bleeding'));
});

test('normal vitals + nothing ticked -> no suggestions', () => {
  const list = AI.generateSuggestions(pd({
    vitals: { pulse: 76, spo2: 98, systolic_bp: 118, diastolic_bp: 78, temperature: 36.8, respiratory_rate: 16 },
  }));
  assert.deepEqual(list, []);
});

test('every ticked symptom gets a suggestion; urgent cards come first', () => {
  const list = AI.generateSuggestions(pd({
    symptoms: { cough_cold: true, unconscious: true },
    vitals: {},
  }));
  assert.equal(list.length, 2, 'RED + GREEN both fire');
  assert.equal(list[0].priority, 'RED', 'urgent card sorts first');
  assert.ok(list.find((s) => s.priority === 'RED' && s.id === 'unconscious'));
  assert.ok(list.find((s) => s.priority === 'GREEN' && s.id === 'cough'));
});

test('multi-symptom patient gets a card for every symptom', () => {
  // Regression: dizziness (YELLOW) must not hide advice for the other
  // ticked symptoms (cough, back pain).
  const list = AI.generateSuggestions(pd({
    symptoms: { dizziness: true, cough_cold: true, back_pain: true },
    vitals: {},
  }));
  const ids = list.map((s) => s.id);
  assert.ok(ids.includes('dizzy'), 'dizziness YELLOW card');
  assert.ok(ids.includes('cough'), 'cough GREEN card');
  assert.ok(ids.includes('back_pain'), 'back pain GREEN card');
  assert.equal(list[0].priority, 'YELLOW', 'urgent card comes first');
});

/* ------------------------------------------------------------------ */
/* Unified plan: one combined solution for ALL symptoms                */
/* ------------------------------------------------------------------ */
test('unified plan: one combined plan covering every symptom', () => {
  const plan = AI.generateUnifiedPlan(pd({
    symptoms: { dizziness: true, cough_cold: true, back_pain: true },
    vitals: {},
  }));
  assert.ok(plan);
  assert.equal(plan.severity, 'YELLOW');
  assert.deepEqual(plan.conditions, ['dizzy', 'cough', 'back_pain']);
  assert.ok(plan.acts.includes('ai.act.dizzy_rest'));
  assert.ok(plan.acts.includes('ai.act.salt_gargle'));
  assert.ok(plan.acts.includes('ai.act.back_lift'));
  assert.equal(plan.whyKeys.length, 3);
  assert.equal(plan.warnKeys.length, 3);
});

test('unified plan: emergency actions come first', () => {
  const plan = AI.generateUnifiedPlan(pd({
    symptoms: { unconscious: true, cough_cold: true },
    vitals: {},
  }));
  assert.ok(plan);
  assert.equal(plan.severity, 'RED');
  assert.ok(plan.acts.indexOf('ai.act.recovery_pos') < plan.acts.indexOf('ai.act.salt_gargle'),
    'RED actions sort before routine actions');
});

test('unified plan: duplicate actions are listed once', () => {
  // fever_high and dehydration both prescribe fluids_sips
  const plan = AI.generateUnifiedPlan(pd({
    symptoms: { high_fever: true, dehydration: true },
    vitals: { temperature: 39.5 },
  }));
  const fluids = plan.acts.filter((a) => a === 'ai.act.fluids_sips');
  assert.equal(fluids.length, 1, 'fluids_sips deduplicated');
});

test('unified plan: null when nothing is detected', () => {
  assert.equal(AI.generateUnifiedPlan(pd({
    vitals: { pulse: 76, spo2: 98, systolic_bp: 118, temperature: 36.8 },
  })), null);
});

/* ------------------------------------------------------------------ */
/* Risk score                                                          */
/* ------------------------------------------------------------------ */
test('risk score is capped at 100', () => {
  const score = AI.calculateRiskScore(pd({
    symptoms: { chest_pain: true, unconscious: true, severe_bleeding: true },
    vitals: { systolic_bp: 200, spo2: 85, pulse: 150, temperature: 41.5 },
  }));
  assert.equal(score, 100);
});

test('low risk for a healthy patient', () => {
  const score = AI.calculateRiskScore(pd({
    vitals: { pulse: 76, spo2: 98, systolic_bp: 118, temperature: 36.8 },
  }));
  assert.ok(score <= 40);
});

test('risk score: a single RED symptom lands in the HIGH band', () => {
  const score = AI.calculateRiskScore(pd({ symptoms: { severe_bleeding: true } }));
  assert.ok(score >= 70, 'RED symptom must score >= 70 (HIGH risk)');
});

test('risk score: a single YELLOW symptom lands in the MEDIUM band', () => {
  const score = AI.calculateRiskScore(pd({ symptoms: { dizziness: true } }));
  assert.ok(score >= 40 && score < 70, 'YELLOW symptom must score 40-69 (MEDIUM risk)');
});

/* ------------------------------------------------------------------ */
/* Translation completeness: every key the engine emits must exist      */
/* ------------------------------------------------------------------ */
function allSuggestionKeys() {
  const seen = new Set();
  const scenarios = [
    { symptoms: { unconscious: true } },
    { symptoms: { severe_bleeding: true } },
    { symptoms: { chest_pain: true }, vitals: { systolic_bp: 185, diastolic_bp: 110 } },
    { symptoms: { difficulty_breathing: true } },
    { vitals: { spo2: 88 } },
    { vitals: { systolic_bp: 200 } },
    { vitals: { systolic_bp: 85 } },
    { vitals: { pulse: 145 } },
    { vitals: { temperature: 41.2 } },
    { symptoms: { pregnancy_complication: true } },
    { symptoms: { stiff_neck: true } },
    { vitals: { systolic_bp: 170, diastolic_bp: 100 } },
    { symptoms: { high_fever: true }, vitals: { temperature: 39.5 } },
    { symptoms: { continuous_vomiting: true } },
    { symptoms: { severe_headache: true } },
    { symptoms: { dehydration: true } },
    { symptoms: { severe_abdominal_pain: true } },
    { symptoms: { severe_injury: true } },
    { symptoms: { severe_headache: true }, vitals: { systolic_bp: 150 }, history: { pregnant: true } },
    { symptoms: { high_fever: true }, history: { diabetic: true } },
    { vitals: { blood_sugar: 320 }, history: { diabetic: true } },
    { symptoms: { cough_cold: true }, vitals: { temperature: 38.2 } },
    { symptoms: { diarrhea: true } },
    { symptoms: { fatigue: true, body_ache: true } },
    { symptoms: { cough_cold: true } },
    { symptoms: { high_fever: true } },
    { symptoms: { urination_problem: true } },
    { symptoms: { dizziness: true } },
    { symptoms: { numbness: true } },
    { symptoms: { swelling: true } },
    { symptoms: { sore_throat: true } },
    { symptoms: { joint_pain: true } },
    { symptoms: { back_pain: true } },
    { symptoms: { skin_rash: true } },
    { symptoms: { eye_problem: true } },
    { symptoms: { ear_pain: true } },
    { symptoms: { acidity: true } },
    { symptoms: { constipation: true } },
    { symptoms: { toothache: true } },
  ];
  for (const sc of scenarios) {
    for (const s of AI.generateSuggestions(pd(sc))) {
      seen.add(s.titleKey);
      seen.add(s.whyKey);
      seen.add(s.warnKey);
      s.acts.forEach((a) => seen.add(a));
    }
  }
  return seen;
}

test('every engine key is translated in en/hi/mr', () => {
  for (const lang of ['en', 'hi', 'mr']) {
    const missing = [...allSuggestionKeys()].filter((k) => !(k in I18N[lang]));
    assert.deepEqual(missing, [], `missing ${lang} translations`);
  }
});

test('every AI_UI key used by the renderer is translated in en/hi/mr', () => {
  const uiKeys = [
    'ai.voice.btn', 'ai.voice.stop', 'ai.voice.listening', 'ai.voice.live',
    'ai.voice.filled', 'ai.voice.none', 'ai.voice.clear', 'ai.voice.unsupported',
    'ai.voice.err', 'ai.voice.toast', 'ai.run', 'ai.ctx', 'ai.ctx.hint', 'ai.need',
    'ai.title', 'ai.sub', 'ai.risk', 'ai.risk.high', 'ai.risk.medium', 'ai.risk.low',
    'ai.none', 'ai.why', 'ai.actions', 'ai.warn', 'ai.disclaimer', 'ai.red.108', 'ai.red.sos',
    'ai.plan.detected', 'ai.plan.actions', 'ai.plan.advice',
  ];
  for (const lang of ['en', 'hi', 'mr']) {
    const missing = uiKeys.filter((k) => !(k in I18N[lang]));
    assert.deepEqual(missing, [], `missing ${lang} UI translations`);
  }
});
