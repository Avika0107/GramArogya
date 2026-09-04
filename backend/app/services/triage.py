"""Rule-based digital triage engine.

Takes symptom checkboxes + vitals and returns RED (emergency) / YELLOW
(urgent) / GREEN (routine) with human-readable reasons.

The ASHA PWA ships an identical JavaScript mirror of this logic so triage
works fully offline; the server recomputes it on sync to stay authoritative.

Rule tree:
  RED    -> any RED symptom OR a vital outside the RED thresholds
  YELLOW -> any YELLOW symptom OR vitals in the YELLOW band OR >= 2 moderate
            symptoms OR any 2+ YELLOW findings
  GREEN  -> everything else
"""

from typing import Dict, Optional

# -- Symptom catalog (keys match the ASHA PWA checkboxes) --------------------
SYMPTOM_LABELS: Dict[str, str] = {
    "chest_pain": "Chest pain",
    "difficulty_breathing": "Difficulty breathing",
    "unconscious": "Unconscious / not responding",
    "severe_bleeding": "Severe bleeding",
    "stiff_neck": "Stiff neck",
    "pregnancy_complication": "Pregnancy complication",
    "high_fever": "High fever",
    "continuous_vomiting": "Continuous vomiting",
    "severe_headache": "Severe headache",
    "dehydration": "Signs of dehydration",
    "severe_abdominal_pain": "Severe abdominal pain",
    "severe_injury": "Severe injury / fracture",
    "abdominal_pain": "Abdominal pain",
    "diarrhea": "Diarrhea",
    "cough_cold": "Cough / cold",
    "fatigue": "Fatigue / weakness",
    "body_ache": "Body ache",
    # Common outpatient problems added for wider coverage (voice fill)
    "urination_problem": "Frequent / painful urination",
    "sore_throat": "Sore throat / throat pain",
    "joint_pain": "Joint pain / swelling",
    "back_pain": "Back pain",
    "skin_rash": "Skin rash / itching",
    "eye_problem": "Eye redness / watering / pain",
    "ear_pain": "Ear pain / discharge",
    "dizziness": "Dizziness / giddiness",
    "acidity": "Acidity / indigestion / gas",
    "constipation": "Constipation",
    "toothache": "Toothache / gum problem",
    "numbness": "Numbness / tingling",
    "swelling": "Swelling (face / hands / feet)",
}

RED_SYMPTOMS = {
    "chest_pain",
    "difficulty_breathing",
    "unconscious",
    "severe_bleeding",
    "stiff_neck",
    "pregnancy_complication",
}

YELLOW_SYMPTOMS = {
    "high_fever",
    "continuous_vomiting",
    "severe_headache",
    "dehydration",
    "severe_abdominal_pain",
    "severe_injury",
}

# Mild symptoms: 2+ of these escalate GREEN -> YELLOW
MODERATE_SYMPTOMS = {
    "abdominal_pain",
    "diarrhea",
    "cough_cold",
    "fatigue",
    "body_ache",
    # Common outpatient problems (added with the voice fill feature)
    "urination_problem",
    "sore_throat",
    "joint_pain",
    "back_pain",
    "skin_rash",
    "eye_problem",
    "ear_pain",
    "dizziness",
    "acidity",
    "constipation",
    "toothache",
    "numbness",
    "swelling",
}

SCORE = {"RED": 100, "YELLOW": 50, "GREEN": 10}

RECOMMENDATION = {
    "RED": "EMERGENCY: Arrange immediate transport / call 108. Do not move the patient "
           "unnecessarily. Inform the nearest hospital NOW.",
    "YELLOW": "URGENT: Advise the patient to reach the PHC today. Re-assess vitals in "
              "4 hours if symptoms persist or worsen.",
    "GREEN": "ROUTINE: Home care advice. Schedule a routine PHC visit if symptoms "
             "continue beyond 48 hours.",
}


def _num(vitals: Dict, key: str) -> Optional[float]:
    val = vitals.get(key)
    try:
        return float(val) if val is not None and val != "" else None
    except (TypeError, ValueError):
        return None


def assess(symptoms: Optional[Dict[str, bool]], vitals: Optional[Dict]) -> Dict:
    """Evaluate symptoms + vitals -> {color, score, reasons, recommendation}."""
    symptoms = symptoms or {}
    vitals = vitals or {}
    reasons: list[str] = []

    spo2 = _num(vitals, "spo2")
    pulse = _num(vitals, "pulse")
    sbp = _num(vitals, "systolic_bp")
    temp = _num(vitals, "temperature")
    rr = _num(vitals, "respiratory_rate")

    # ---- RED checks ---------------------------------------------------------
    red = False
    for sym in RED_SYMPTOMS:
        if symptoms.get(sym):
            red = True
            reasons.append(f"Symptom: {SYMPTOM_LABELS[sym]}")

    if spo2 is not None and spo2 < 90:
        red = True
        reasons.append(f"SpO2 {spo2:g}% (critical hypoxia, < 90%)")
    if pulse is not None and (pulse <= 40 or pulse >= 140):
        red = True
        reasons.append(f"Pulse {pulse:g} bpm (outside 40-140)")
    if sbp is not None and (sbp <= 90 or sbp >= 180):
        red = True
        reasons.append(f"Systolic BP {sbp:g} mmHg (<= 90 or >= 180)")
    if temp is not None and temp >= 41.0:
        red = True
        reasons.append(f"Temperature {temp:g}°C (hyperpyrexia, >= 41)")
    if rr is not None and (rr < 8 or rr > 30):
        red = True
        reasons.append(f"Respiratory rate {rr:g}/min (outside 8-30)")

    if red:
        return {
            "color": "RED",
            "score": SCORE["RED"],
            "reasons": reasons,
            "recommendation": RECOMMENDATION["RED"],
        }

    # ---- YELLOW checks ------------------------------------------------------
    yellow = False
    for sym in YELLOW_SYMPTOMS:
        if symptoms.get(sym):
            yellow = True
            reasons.append(f"Symptom: {SYMPTOM_LABELS[sym]}")

    if spo2 is not None and 90 <= spo2 <= 93:
        yellow = True
        reasons.append(f"SpO2 {spo2:g}% (90-93%, borderline)")
    if pulse is not None and (120 <= pulse <= 139 or 41 <= pulse <= 49):
        yellow = True
        reasons.append(f"Pulse {pulse:g} bpm (borderline)")
    if sbp is not None and (91 <= sbp <= 99 or 160 <= sbp <= 179):
        yellow = True
        reasons.append(f"Systolic BP {sbp:g} mmHg (borderline)")
    if temp is not None and 39.0 <= temp < 41.0:
        yellow = True
        reasons.append(f"Temperature {temp:g}°C (high fever, 39-41)")

    moderate_hits = [s for s in MODERATE_SYMPTOMS if symptoms.get(s)]
    if len(moderate_hits) >= 2:
        yellow = True
        reasons.append(
            "Multiple moderate symptoms: " + ", ".join(SYMPTOM_LABELS[s] for s in moderate_hits)
        )

    if yellow:
        return {
            "color": "YELLOW",
            "score": SCORE["YELLOW"],
            "reasons": reasons,
            "recommendation": RECOMMENDATION["YELLOW"],
        }

    # ---- GREEN --------------------------------------------------------------
    if not reasons:
        reasons.append("No RED/YELLOW findings — vitals within normal range")
    return {
        "color": "GREEN",
        "score": SCORE["GREEN"],
        "reasons": reasons,
        "recommendation": RECOMMENDATION["GREEN"],
    }