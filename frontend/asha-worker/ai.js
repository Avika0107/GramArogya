/* GramArogya ASHA PWA — AI clinical assistant engine (pure, offline).
 *
 * Two capabilities, mirroring the "AI-powered voice-to-text + smart clinical
 * suggestions" feature:
 *
 *  1. detectFromTranscript()     voice -> symptom auto-fill keywords. The Web
 *                                Speech API part lives in app.js (browser only);
 *                                this file only maps recognised words/phrases
 *                                onto the existing symptom checkbox keys.
 *  2. generateSuggestions()      rule-based "doctor is not available" advice.
 *                                Advisory only: the authoritative triage stays
 *                                localTriage() (mirror of backend triage.py).
 *                                Returns structured suggestions whose text is
 *                                i18n keys (resolved by app.js -> t()), so this
 *                                file contains no UI strings and can be unit
 *                                tested in Node.
 *
 * No DOM, no fetch, no localStorage — runs fully offline and in Node.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.GramArogyaAI = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* Voice keyword map: spoken word/phrase -> existing symptom key       */
  /* (English + romanised Hindi + Devanagari Hindi/Marathi)              */
  /* ------------------------------------------------------------------ */
  const SYMPTOM_KEYWORDS = {
    chest_pain: [
      'chest pain', 'chest me dard', 'chhati me dard', 'chhati dard', 'chati dard',
      'sine me dard', 'seene me dard', 'heart pain', 'dil ka dard',
      'छाती में दर्द', 'छाती मे दर्द', 'सीने में दर्द', 'छाती दर्द', 'हृदय दर्द', 'छातीत दुखणे',
    ],
    difficulty_breathing: [
      'breathing difficulty', 'difficulty breathing', 'breathless', 'breathlessness',
      'breathing', 'saans lene me takleef', 'sans lene me takleef', 'saans', 'sans',
      'saas phoolna', 'dum', 'सांस लेने में तकलीफ', 'साँस लेने में तकलीफ', 'सांस फूलना',
      'साँस फूलना', 'दम', 'श्वास घेताना त्रास', 'दम लागणे',
    ],
    unconscious: [
      'unconscious', 'behosh', 'behos', 'faint', 'hoosh', 'gyan chala gaya',
      'बेहोश', 'बेहोस', 'अचेत', 'भान गेलं',
    ],
    severe_bleeding: [
      'severe bleeding', 'bleeding', 'bleed', 'blood', 'khoon', 'khun', 'rakt',
      'blood bah raha', 'खून', 'रक्त', 'रक्तस्त्राव', 'खूप रक्त येणे',
    ],
    stiff_neck: [
      'stiff neck', 'neck stiff', 'gardan akad', 'गर्दन अकड़', 'गर्दन में अकड़न', 'मान गळकाठ',
    ],
    pregnancy_complication: [
      'pregnancy complication', 'pregnancy problem', 'pregnant', 'pregnancy',
      'garbhavastha', 'garbh', 'delivery', 'गर्भावस्था', 'गर्भवती', 'प्रसव', 'गर्भधारणा', 'प्रसूती त्रास',
    ],
    high_fever: [
      'fever', 'bukhar', 'bukhaar', 'taap', 'tap', 'tez bukhar', 'tej bukhar',
      'बुखार', 'ताप', 'तेज़ बुखार', 'तेज बुखार', 'तापमान', 'ताप येणे', 'ताप जास्त',
    ],
    continuous_vomiting: [
      'continuous vomiting', 'vomiting', 'vomit', 'ulti', 'ughli', 'ulta', 'nausea',
      'ulti aa rahi', 'उल्टी', 'उलटी', 'मळमळ', 'ओक', 'उलट्या होत आहेत',
    ],
    severe_headache: [
      'severe headache', 'headache', 'sir dard', 'sir me dard', 'sir mein dard',
      'head pain', 'tej sir dard', 'तेज़ सिरदर्द', 'सिर दर्द', 'सिरदर्द', 'तेज डोकेदुखी', 'डोके दुखणे',
    ],
    dehydration: [
      'dehydration', 'pani ki kami', 'paani ki kami', 'water loss', 'पानी की कमी',
      'पाण्याची कमी', 'डिहाइड्रेशन', 'शरीरात पाणी कमी',
    ],
    severe_abdominal_pain: [
      'severe abdominal pain', 'severe stomach pain', 'pet me tez dard', 'pet me bahut dard',
      'पेट में तेज़ दर्द', 'तेज पेट दर्द', 'पोटात तीव्र दुखणे', 'पोटात खूप दुखणे',
    ],
    abdominal_pain: [
      'abdominal pain', 'stomach pain', 'pet dard', 'pet me dard', 'pet mein dard',
      'पेट दर्द', 'पेट में दर्द', 'पोटदुखी', 'पोट दुखणे', 'ओटपोट दुखणे',
    ],
    diarrhea: [
      'diarrhea', 'diarrhoea', 'dast', 'loose motion', 'loose motions', 'paich',
      'दस्त', 'पेचिश', 'जुलाब', 'अतिसार', 'जुलाब होणे',
    ],
    cough_cold: [
      'cough', 'coughing', 'khansi', 'khasi', 'cold', 'zukam', 'sardi',
      'खांसी', 'खाँसी', 'जुकाम', 'सर्दी', 'खोकला', 'सरदी',
    ],
    fatigue: [
      'fatigue', 'weakness', 'kamzori', 'kamjor', 'thakan', 'thakaan', 'kamzori lag rahi',
      'कमजोरी', 'थकान', 'कमजोर', 'दुर्बलता', 'अशक्तपणा', 'थकवा',
    ],
    body_ache: [
      'body ache', 'body pain', 'badan dard', 'jism me dard', 'sarir dard',
      'बदन दर्द', 'शरीर में दर्द', 'अंग दुखणे', 'सर्वांग दुखणे',
    ],
    severe_injury: [
      'serious injury', 'severe injury', 'injury', 'chot', 'fracture', 'haddi', 'accident',
      'चोट', 'फ्रैक्चर', 'हड्डी', 'अपघात', 'गंभीर दुखापत',
    ],
    urination_problem: [
      'urine problem', 'urination problem', 'frequent urination', 'urine', 'urin',
      'peshab', 'peshaab', 'pesab', 'mutra', 'baar baar peshab', 'der se peshab',
      'peshab me jalan', 'peshab me jala',
      'पेशाब', 'पेशाव', 'बार-बार पेशाब', 'मूत्र', 'पेशाब में जलन', 'बारंबार मूत्र',
      'लघवी', 'लघवीला त्रास', 'मूत्र त्रास',
    ],
    sore_throat: [
      'sore throat', 'throat pain', 'throat', 'gala', 'gale me dard', 'gale mein dard',
      'कंठ', 'गले में दर्द', 'गला खराब', 'गळा दुखणे', 'घशात दुखणे',
    ],
    joint_pain: [
      'joint pain', 'joints pain', 'jodo me dard', 'jod', 'gathiya',
      'ghutne me dard', 'ghutno me dard', 'ghutno me bahut dard', 'ghutna dard',
      'जोड़ों में दर्द', 'जोड़ दर्द', 'घुटनों में दर्द', 'सांध्य दुखणे', 'गुडघे दुखणे',
    ],
    back_pain: [
      'back pain', 'backache', 'kamar dard', 'kamar me dard', 'peeth dard',
      'पीठ दर्द', 'कमर दर्द', 'कमर में दर्द', 'पाठी दुखणे', 'कमरे दुखणे',
    ],
    skin_rash: [
      'skin rash', 'rash', 'itching', 'itch', 'khujli', 'khuj', 'dane', 'dabbe',
      'चकत्ते', 'दाने', 'खुजली', 'खाज', 'त्वचा पर चकत्ते', 'पुरळ', 'खाज सुटणे',
    ],
    eye_problem: [
      'eye problem', 'eye pain', 'red eyes', 'watery eyes', 'aankh', 'aankho me dard',
      'आँख', 'आंख में दर्द', 'आँख लाल', 'आँखों में पानी', 'डोळे दुखणे', 'डोळे लाल',
    ],
    ear_pain: [
      'ear pain', 'earache', 'ear discharge', 'kaan', 'kaan me dard', 'kaan se paani',
      'कान दर्द', 'कान में दर्द', 'कान बहना', 'कान दुखणे', 'कानातून पाणी',
    ],
    dizziness: [
      'dizziness', 'dizzy', 'giddiness', 'chakkar', 'chakar', 'ghoomna', 'sir ghoom raha',
      'चक्कर', 'चक्कर आना', 'सिर घूमना', 'चक्कर येणे', 'डोके फिरणे',
    ],
    acidity: [
      'acidity', 'gas problem', 'indigestion', 'heartburn', 'pet me jalan', 'seene me jalan',
      'एसिडिटी', 'गैस', 'अपच', 'सीने में जलन', 'पेट में जलन', 'आम्लपित्त', 'ढेकर',
    ],
    constipation: [
      'constipation', 'kabj', 'kabz', 'potty nahi', 'motion nahi', 'stool problem',
      'कब्ज', 'कब्ज़', 'मल न आना', 'बदबद', 'आतड्यांची हालचाल नाही',
    ],
    toothache: [
      'toothache', 'tooth pain', 'teeth pain', 'daant', 'dant', 'daant dard', 'dant dard',
      'daant me dard', 'daant me bahut dard', 'masuda',
      'दांत दर्द', 'दाँत दर्द', 'मसूड़ों में दर्द', 'दात दुखणे', 'हिरड्या दुखणे',
    ],
    numbness: [
      'numbness', 'tingling', 'sunn', 'sun ho gaya', 'sunn ho gaya', 'jhunjhunaahat', 'jhanjhanahat',
      'सुन्न', 'सुन्न होना', 'झनझनाहट', 'सुन्न होणे', 'मुंग्या आल्या',
    ],
    swelling: [
      'swelling', 'swollen', 'soojan', 'sujan', 'suj gaya', 'paer me sujan', 'hath me sujan',
      'सूजन', 'सूज', 'पैर में सूजन', 'हाथ में सूजन', 'चेहरे पर सूजन', 'सूज आले',
    ],
  };

  /* ------------------------------------------------------------------ */
  /* Transcript -> detected symptoms                                     */
  /* ------------------------------------------------------------------ */
  function escapeRe(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /* Match a keyword against the lowercased transcript. Multi-word
   * keywords use substring matching; single words use word boundaries so
   * "dast" does not match inside "dastawez", "fit" inside "shift", etc.
   * Devanagari letters are treated as word characters for both scripts. */
  function textHas(text, kw) {
    if (kw.indexOf(' ') !== -1) return text.indexOf(kw) !== -1;
    const re = new RegExp('(^|[^a-z\\u0900-\\u097F])' + escapeRe(kw) + '($|[^a-z\\u0900-\\u097F])');
    return re.test(text);
  }

  function normalizeTranscript(raw) {
    return String(raw || '')
      .toLowerCase()
      .replace(/[.,!?;:()"'/\\\-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /* Returns { symptoms: {key: true}, found: [keys] } */
  function detectFromTranscript(transcript) {
    const text = normalizeTranscript(transcript);
    const symptoms = {};
    const found = [];
    if (!text) return { symptoms, found };
    Object.keys(SYMPTOM_KEYWORDS).forEach((key) => {
      const hit = SYMPTOM_KEYWORDS[key].some((kw) => textHas(text, kw));
      if (hit) { symptoms[key] = true; found.push(key); }
    });
    return { symptoms, found };
  }

  /* ------------------------------------------------------------------ */
  /* Suggestion engine (advisory, when the doctor is not available)      */
  /* ------------------------------------------------------------------ */
  const PRIORITY_RANK = { RED: 0, YELLOW: 1, GREEN: 2 };

  function num(vitals, key) {
    const v = vitals ? vitals[key] : null;
    if (v === undefined || v === null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  function bool(symptoms, key) {
    return !!(symptoms && symptoms[key]);
  }

  /* Shared, translatable action keys (resolved by the UI through t()). */
  const ACT = {
    call108: 'ai.act.call108',
    hospital_now: 'ai.act.hospital_now',
    lie_flat: 'ai.act.lie_flat',
    loosen: 'ai.act.loosen',
    keepwarm: 'ai.act.keepwarm',
    no_food_water: 'ai.act.no_food_water',
    monitor_vitals: 'ai.act.monitor_vitals',
    recovery_pos: 'ai.act.recovery_pos',
    cpr: 'ai.act.cpr',
    check_id: 'ai.act.check_id',
    pressure_wound: 'ai.act.pressure_wound',
    elevate_part: 'ai.act.elevate_part',
    oxygen: 'ai.act.oxygen',
    sit_upright: 'ai.act.sit_upright',
    blue_watch: 'ai.act.blue_watch',
    still_calm: 'ai.act.still_calm',
    rest_recheck_bp: 'ai.act.rest_recheck_bp',
    bp_meds: 'ai.act.bp_meds',
    no_salt_caffeine: 'ai.act.no_salt_caffeine',
    phc_24h: 'ai.act.phc_24h',
    red_flag_watch: 'ai.act.red_flag_watch',
    paracetamol_dose: 'ai.act.paracetamol_dose',
    sponge_bath: 'ai.act.sponge_bath',
    fluids_sips: 'ai.act.fluids_sips',
    light_clothes: 'ai.act.light_clothes',
    temp_every_2h: 'ai.act.temp_every_2h',
    left_side: 'ai.act.left_side',
    no_meds_preg: 'ai.act.no_meds_preg',
    phc_today: 'ai.act.phc_today',
    preg_watch: 'ai.act.preg_watch',
    ors_each_stool: 'ai.act.ors_each_stool',
    diarrhea_watch: 'ai.act.diarrhea_watch',
    steam_inhale: 'ai.act.steam_inhale',
    salt_gargle: 'ai.act.salt_gargle',
    cough_watch: 'ai.act.cough_watch',
    honey_warm: 'ai.act.honey_warm',
    rest_home: 'ai.act.rest_home',
    fever_watch: 'ai.act.fever_watch',
    dehydr_watch: 'ai.act.dehydr_watch',
    light_meals: 'ai.act.light_meals',
    sips_ors: 'ai.act.sips_ors',
    inj_immobilize: 'ai.act.inj_immobilize',
    inj_cold: 'ai.act.inj_cold',
    movement_check: 'ai.act.movement_check',
    abdo_no_meds: 'ai.act.abdo_no_meds',
    diabetic_watch: 'ai.act.diabetic_watch',
    review_doc: 'ai.act.review_doc',
    temp_daily2: 'ai.act.temp_daily2',
    rest_quiet: 'ai.act.rest_quiet',
    monitor_5min: 'ai.act.monitor_5min',
    no_sweets: 'ai.act.no_sweets',
    // New common-problem actions (voice fill)
    uti_fluids: 'ai.act.uti_fluids',
    uti_phc: 'ai.act.uti_phc',
    uti_watch: 'ai.act.uti_watch',
    throat_soothe: 'ai.act.throat_soothe',
    joint_warm: 'ai.act.joint_warm',
    joint_phc: 'ai.act.joint_phc',
    back_lift: 'ai.act.back_lift',
    back_phc: 'ai.act.back_phc',
    rash_clean: 'ai.act.rash_clean',
    rash_phc: 'ai.act.rash_phc',
    eye_cold: 'ai.act.eye_cold',
    eye_phc: 'ai.act.eye_phc',
    ear_rest: 'ai.act.ear_rest',
    ear_phc: 'ai.act.ear_phc',
    dizzy_rest: 'ai.act.dizzy_rest',
    dizzy_phc: 'ai.act.dizzy_phc',
    acid_food: 'ai.act.acid_food',
    acid_med: 'ai.act.acid_med',
    const_water: 'ai.act.const_water',
    const_med: 'ai.act.const_med',
    tooth_rinse: 'ai.act.tooth_rinse',
    tooth_phc: 'ai.act.tooth_phc',
    numb_watch: 'ai.act.numb_watch',
    numb_phc: 'ai.act.numb_phc',
    swell_watch: 'ai.act.swell_watch',
    swell_phc: 'ai.act.swell_phc',
  };

  /* Rule metadata: the when() bodies do the clinical evaluation; each hit
   * becomes { priority, id, titleKey, titleVars, whyKey, warnKey, acts }. */
  function evaluate(patientData) {
    const s = (patientData && patientData.symptoms) || {};
    const v = (patientData && patientData.vitals) || {};
    const h = (patientData && patientData.history) || {};

    const spo2 = num(v, 'spo2');
    const pulse = num(v, 'pulse');
    const sbp = num(v, 'systolic_bp');
    const dbp = num(v, 'diastolic_bp');
    const temp = num(v, 'temperature');
    const rr = num(v, 'respiratory_rate');
    const sugar = num(v, 'blood_sugar');

    const mk = (priority, id, acts, titleVars) => ({
      priority,
      id,
      titleKey: 'ai.t.' + id,
      titleVars: titleVars || [],
      whyKey: 'ai.w.' + id,
      warnKey: 'ai.c.' + id,
      acts,
    });

    const reds = [];
    const yellows = [];
    const greens = [];

    /* ---- RED (emergency) -------------------------------------------- */
    if (bool(s, 'unconscious')) {
      reds.push(mk('RED', 'unconscious',
        [ACT.recovery_pos, ACT.cpr, ACT.call108, ACT.no_food_water, ACT.check_id, ACT.monitor_vitals]));
    }
    if (bool(s, 'severe_bleeding')) {
      reds.push(mk('RED', 'bleeding',
        [ACT.pressure_wound, ACT.elevate_part, ACT.call108, ACT.keepwarm, ACT.no_food_water]));
    }
    if (bool(s, 'chest_pain')) {
      reds.push(mk('RED', 'chest_pain',
        [ACT.lie_flat, ACT.loosen, ACT.still_calm, ACT.call108, ACT.monitor_vitals]));
    }
    if (bool(s, 'difficulty_breathing')) {
      reds.push(mk('RED', 'breath',
        [ACT.sit_upright, ACT.loosen, ACT.oxygen, ACT.call108, ACT.blue_watch, ACT.monitor_vitals]));
    }
    if (spo2 !== null && spo2 < 90) {
      reds.push(mk('RED', 'spo2',
        [ACT.oxygen, ACT.sit_upright, ACT.loosen, ACT.call108, ACT.monitor_5min, ACT.blue_watch],
        [spo2]));
    }
    if (sbp !== null && sbp >= 180) {
      reds.push(mk('RED', 'bp_very_high',
        [ACT.still_calm, ACT.hospital_now, ACT.red_flag_watch, ACT.monitor_vitals],
        [sbp, dbp === null ? '?' : dbp]));
    }
    if (sbp !== null && sbp <= 90) {
      reds.push(mk('RED', 'bp_very_low',
        [ACT.lie_flat, ACT.keepwarm, ACT.call108, ACT.monitor_vitals],
        [sbp]));
    }
    if (pulse !== null && (pulse <= 40 || pulse >= 140)) {
      reds.push(mk('RED', 'pulse_extreme',
        [ACT.still_calm, ACT.call108, ACT.red_flag_watch, ACT.monitor_vitals],
        [pulse]));
    }
    if (temp !== null && temp >= 41) {
      reds.push(mk('RED', 'temp_extreme',
        [ACT.light_clothes, ACT.sponge_bath, ACT.fluids_sips, ACT.hospital_now],
        [temp]));
    }
    if (bool(s, 'pregnancy_complication')) {
      reds.push(mk('RED', 'preg_comp',
        [ACT.call108, ACT.hospital_now, ACT.left_side, ACT.keepwarm, ACT.monitor_vitals]));
    }
    if (bool(s, 'stiff_neck')) {
      reds.push(mk('RED', 'stiff_neck',
        [ACT.hospital_now, ACT.red_flag_watch, ACT.fluids_sips]));
    }

    /* ---- YELLOW (urgent, within hours) ------------------------------ */
    if (sbp !== null && sbp >= 160 && sbp < 180) {
      yellows.push(mk('YELLOW', 'bp_high',
        [ACT.rest_recheck_bp, ACT.bp_meds, ACT.no_salt_caffeine, ACT.phc_24h, ACT.red_flag_watch],
        [sbp, dbp === null ? '?' : dbp]));
    }
    const feverSymptom = bool(s, 'high_fever');
    if (feverSymptom || (temp !== null && temp >= 39 && temp < 41)) {
      yellows.push(mk('YELLOW', 'fever_high',
        [ACT.paracetamol_dose, ACT.sponge_bath, ACT.fluids_sips, ACT.light_clothes,
          ACT.temp_every_2h, ACT.fever_watch],
        [temp === null ? [] : [temp]]));
    }
    if (bool(s, 'continuous_vomiting')) {
      yellows.push(mk('YELLOW', 'vomiting',
        [ACT.sips_ors, ACT.light_meals, ACT.phc_today, ACT.dehydr_watch]));
    }
    if (bool(s, 'severe_headache')) {
      yellows.push(mk('YELLOW', 'headache_sev',
        [ACT.rest_quiet, ACT.monitor_vitals, ACT.phc_today, ACT.red_flag_watch]));
    }
    if (bool(s, 'dehydration')) {
      yellows.push(mk('YELLOW', 'dehydration',
        [ACT.sips_ors, ACT.fluids_sips, ACT.dehydr_watch, ACT.phc_today]));
    }
    if (bool(s, 'severe_abdominal_pain')) {
      yellows.push(mk('YELLOW', 'abdo_sev',
        [ACT.no_food_water, ACT.abdo_no_meds, ACT.phc_today, ACT.red_flag_watch]));
    }
    if (bool(s, 'severe_injury')) {
      yellows.push(mk('YELLOW', 'injury',
        [ACT.inj_immobilize, ACT.inj_cold, ACT.phc_today, ACT.keepwarm]));
    }
    // Pre-eclampsia: pregnant + high BP + severe headache
    if (h.pregnant && sbp !== null && sbp >= 140 && bool(s, 'severe_headache')) {
      yellows.push(mk('YELLOW', 'preeclampsia',
        [ACT.left_side, ACT.no_meds_preg, ACT.phc_today, ACT.movement_check, ACT.preg_watch],
        [sbp, dbp === null ? '?' : dbp]));
    }
    // Known diabetic who is acutely unwell -> early PHC review
    if (h.diabetic && (feverSymptom || bool(s, 'continuous_vomiting') || bool(s, 'dehydration'))) {
      yellows.push(mk('YELLOW', 'diabetic_sick',
        [ACT.phc_today, ACT.fluids_sips, ACT.diabetic_watch, ACT.review_doc]));
    }
    if (h.diabetic && sugar !== null && sugar > 300) {
      yellows.push(mk('YELLOW', 'sugar_high',
        [ACT.fluids_sips, ACT.no_sweets, ACT.phc_today, ACT.diabetic_watch],
        [sugar]));
    }
    // Frequent / painful urination — usually a urinary infection
    if (bool(s, 'urination_problem')) {
      yellows.push(mk('YELLOW', 'urinary',
        [ACT.uti_fluids, ACT.uti_phc, ACT.uti_watch]));
    }
    // Dizziness — repeated episodes need a check
    if (bool(s, 'dizziness')) {
      yellows.push(mk('YELLOW', 'dizzy',
        [ACT.dizzy_rest, ACT.fluids_sips, ACT.review_doc, ACT.dizzy_phc]));
    }
    // Numbness / tingling — possible nerve or circulation problem
    if (bool(s, 'numbness')) {
      yellows.push(mk('YELLOW', 'numbness',
        [ACT.numb_phc, ACT.numb_watch, ACT.fluids_sips]));
    }
    // New swelling of face/hands/feet — needs evaluation
    if (bool(s, 'swelling')) {
      yellows.push(mk('YELLOW', 'swelling',
        [ACT.swell_phc, ACT.swell_watch, ACT.fluids_sips]));
    }

    /* ---- GREEN (routine) --------------------------------------------
     * Always evaluated so every ticked symptom gets its own advice card
     * (RED/YELLOW findings still sort first). Each rule self-suppresses
     * on fever / related urgency, so urgent + routine advice never clash.
     * ---------------------------------------------------------------- */
    if (temp !== null && temp >= 37.8 && temp < 39 && !feverSymptom) {
      greens.push(mk('GREEN', 'mild_fever',
        [ACT.rest_home, ACT.fluids_sips, ACT.paracetamol_dose, ACT.light_clothes,
          ACT.temp_daily2, ACT.fever_watch],
        [temp]));
    }
    if (bool(s, 'cough_cold') && !bool(s, 'difficulty_breathing') && !feverSymptom &&
        !(temp !== null && temp >= 39)) {
      greens.push(mk('GREEN', 'cough',
        [ACT.salt_gargle, ACT.steam_inhale, ACT.honey_warm, ACT.rest_home, ACT.cough_watch]));
    }
    if (bool(s, 'diarrhea') && !bool(s, 'dehydration') && !bool(s, 'continuous_vomiting') &&
        !feverSymptom && !(temp !== null && temp >= 38)) {
      greens.push(mk('GREEN', 'diarrhea',
        [ACT.ors_each_stool, ACT.fluids_sips, ACT.light_meals, ACT.diarrhea_watch]));
    }
    if ((bool(s, 'fatigue') || bool(s, 'body_ache')) &&
        !(temp !== null && temp >= 37.8)) {
      greens.push(mk('GREEN', 'weak',
        [ACT.rest_home, ACT.fluids_sips, ACT.light_meals, ACT.review_doc]));
    }
    if (bool(s, 'sore_throat') && !bool(s, 'cough_cold') && !feverSymptom &&
        !(temp !== null && temp >= 38)) {
      greens.push(mk('GREEN', 'sore_throat',
        [ACT.salt_gargle, ACT.throat_soothe, ACT.fluids_sips, ACT.fever_watch]));
    }
    if (bool(s, 'joint_pain') && !(temp !== null && temp >= 38)) {
      greens.push(mk('GREEN', 'joint_pain',
        [ACT.joint_warm, ACT.rest_home, ACT.joint_phc, ACT.review_doc]));
    }
    if (bool(s, 'back_pain') && !(temp !== null && temp >= 38)) {
      greens.push(mk('GREEN', 'back_pain',
        [ACT.back_lift, ACT.rest_home, ACT.back_phc]));
    }
    if (bool(s, 'skin_rash') && !feverSymptom && !(temp !== null && temp >= 38)) {
      greens.push(mk('GREEN', 'skin_rash',
        [ACT.rash_clean, ACT.rash_phc]));
    }
    if (bool(s, 'eye_problem') && !(temp !== null && temp >= 38)) {
      greens.push(mk('GREEN', 'eye_problem',
        [ACT.eye_cold, ACT.eye_phc]));
    }
    if (bool(s, 'ear_pain') && !(temp !== null && temp >= 38)) {
      greens.push(mk('GREEN', 'ear_pain',
        [ACT.ear_rest, ACT.ear_phc]));
    }
    if (bool(s, 'acidity') && !(temp !== null && temp >= 38)) {
      greens.push(mk('GREEN', 'acidity',
        [ACT.acid_food, ACT.acid_med, ACT.fluids_sips]));
    }
    if (bool(s, 'constipation') && !(temp !== null && temp >= 38)) {
      greens.push(mk('GREEN', 'constipation',
        [ACT.const_water, ACT.const_med, ACT.light_meals]));
    }
    if (bool(s, 'toothache') && !(temp !== null && temp >= 38)) {
      greens.push(mk('GREEN', 'toothache',
        [ACT.tooth_rinse, ACT.tooth_phc]));
    }

    return reds.concat(yellows, greens);
  }

  function generateSuggestions(patientData) {
    const list = evaluate(patientData || {});
    return list.sort((a, b) =>
      PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || 0);
  }

  /* Combine every fired rule into ONE unified plan for the patient.
   * Returns { severity, conditions, titleKeys, titleVars, whyKeys,
   * warnKeys, acts } where `acts` is a single ordered, deduplicated
   * action list (emergency actions first) covering ALL detected
   * problems together. Returns null when nothing is detected. */
  function generateUnifiedPlan(patientData) {
    const list = generateSuggestions(patientData || {});
    if (!list.length) return null;
    let severity = list[0].priority;
    const acts = [];
    const seen = new Set();
    list.forEach((s) => {
      if (PRIORITY_RANK[s.priority] < PRIORITY_RANK[severity]) severity = s.priority;
      s.acts.forEach((a) => {
        if (!seen.has(a)) { seen.add(a); acts.push(a); }
      });
    });
    return {
      severity,
      conditions: list.map((s) => s.id),
      titleKeys: list.map((s) => s.titleKey),
      titleVars: list.map((s) => s.titleVars),
      whyKeys: list.map((s) => s.whyKey),
      warnKeys: list.map((s) => s.warnKey),
      acts,
    };
  }

  /* 0-100 risk score (reference number, NOT the badge level — the badge
   * follows the clinical severity from generateUnifiedPlan). Weights are
   * banded so a single RED finding lands in the HIGH band (>= 70) and a
   * single YELLOW finding in the MEDIUM band (>= 40). */
  function calculateRiskScore(patientData) {
    const s = (patientData && patientData.symptoms) || {};
    const v = (patientData && patientData.vitals) || {};
    const h = (patientData && patientData.history) || {};
    const spo2 = num(v, 'spo2');
    const pulse = num(v, 'pulse');
    const sbp = num(v, 'systolic_bp');
    const temp = num(v, 'temperature');
    const rr = num(v, 'respiratory_rate');
    let score = 0;

    // RED (emergency) — each alone is HIGH risk
    if (bool(s, 'chest_pain')) score += 75;
    if (bool(s, 'difficulty_breathing')) score += 75;
    if (bool(s, 'unconscious')) score += 75;
    if (bool(s, 'severe_bleeding')) score += 75;
    if (bool(s, 'stiff_neck')) score += 75;
    if (bool(s, 'pregnancy_complication')) score += 75;
    if (spo2 !== null && spo2 < 90) score += 75;
    if (pulse !== null && (pulse <= 40 || pulse >= 140)) score += 75;
    if (sbp !== null && sbp >= 180) score += 75;
    else if (sbp !== null && sbp <= 90) score += 75;
    if (temp !== null && temp >= 41) score += 75;
    if (rr !== null && (rr < 8 || rr > 30)) score += 75;

    // YELLOW (urgent) — each alone is MEDIUM risk
    if (bool(s, 'high_fever')) score += 45;
    if (bool(s, 'continuous_vomiting')) score += 45;
    if (bool(s, 'severe_headache')) score += 45;
    if (bool(s, 'dehydration')) score += 45;
    if (bool(s, 'severe_abdominal_pain')) score += 45;
    if (bool(s, 'severe_injury')) score += 45;
    if (bool(s, 'urination_problem')) score += 45;
    if (bool(s, 'dizziness')) score += 45;
    if (bool(s, 'numbness')) score += 45;
    if (bool(s, 'swelling')) score += 45;
    if (spo2 !== null && spo2 >= 90 && spo2 <= 93) score += 45;
    if (pulse !== null && ((pulse >= 120 && pulse <= 139) || (pulse >= 41 && pulse <= 49))) score += 45;
    if (sbp !== null && sbp >= 160 && sbp < 180) score += 45;
    if (temp !== null && temp >= 39 && temp < 41) score += 45;
    if (h.pregnant && sbp !== null && sbp >= 140 && bool(s, 'severe_headache')) score += 45;

    // Routine (GREEN) — small contribution so routine stacks stay low
    if (bool(s, 'sore_throat')) score += 5;
    if (bool(s, 'joint_pain')) score += 5;
    if (bool(s, 'back_pain')) score += 5;
    if (bool(s, 'skin_rash')) score += 5;
    if (bool(s, 'eye_problem')) score += 5;
    if (bool(s, 'ear_pain')) score += 5;
    if (bool(s, 'acidity')) score += 5;
    if (bool(s, 'constipation')) score += 5;
    if (bool(s, 'toothache')) score += 5;

    return Math.min(100, score);
  }

  return {
    SYMPTOM_KEYWORDS,
    detectFromTranscript,
    generateSuggestions,
    generateUnifiedPlan,
    calculateRiskScore,
    PRIORITY_RANK,
  };
});
