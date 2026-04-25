# Sample clinical text for demo

Three synthetic clinical notes, ordered easy → harder. All names, dates, IDs, and contact info are fabricated. They're designed to exercise different pipes in the demo pipeline:

- **Note 1** — common PHI (regex + whitelist do most of the work).
- **Note 2** — adds an uncommon name and a non-standard date (rules struggle, model helps).
- **Note 3** — narrative-heavy with embedded names, abbreviations, and an institution-specific MRN format (composition really pays off).

For the inference walkthrough in the demo, **Note 1** is a good first paste. **Note 2** is the natural "now show me the model" follow-up. **Note 3** is held in reserve if there's time or questions.

---

## Note 1 — common PHI (good first paste)

```
DISCHARGE SUMMARY

Patient: John Miller
DOB: 03/14/1958
MRN: 4827193
Admitted: 04/12/2025
Discharged: 04/19/2025
Attending: Dr. Sarah Chen

Mr. Miller is a 67-year-old male admitted to Duke University Hospital on
April 12, 2025 with chest pain and shortness of breath. Past medical history
significant for hypertension, type 2 diabetes, and CAD. Wife Linda was at
bedside throughout admission.

Discharge disposition: home with home health.
Follow-up scheduled with Dr. Chen on 4/26/2025.
Patient may be reached at (919) 555-0142 or john.miller58@email.com.
```

**Expected hits:**
- Regex: DOB, MRN, dates, phone, email
- Whitelist (if names dictionary loaded): "Dr. Sarah Chen", "Dr. Chen", "John Miller", "Linda"
- Hospital name ("Duke University Hospital") — likely ML or dictionary

---

## Note 2 — unusual name, non-standard formatting

```
PROGRESS NOTE — 2025-04-22

Patient Aoife O'Sullivan, 42F, presents to clinic for follow-up of recently
diagnosed sarcoidosis. Seen by Dr. Tomasz Rzepecki in pulmonology last
Thursday. Patient lives at 2847 Hillsborough Rd, Apt 3B, Durham NC 27705.
Husband Eamon called the front desk on 4/21 with concerns about new
shortness of breath.

Currently on prednisone 40mg daily. CBC drawn this AM, CMP pending.
Patient's mother Siobhan was diagnosed with the same condition in 1994 at
age 38. Family history otherwise non-contributory.

Plan: continue current regimen, follow-up in 2 weeks. Patient reachable at
9195551763.
```

**Expected hits:**
- Regex: dates (2025-04-22, 4/21, 1994), phone (no separators — tests the pattern), address, age
- Whitelist: probably misses "Aoife", "Tomasz Rzepecki", "Siobhan", "Eamon" unless explicitly in the dictionary
- Model: should pick up the unusual names regex/dictionary missed

---

## Note 3 — narrative, embedded PHI, tougher cases (held in reserve)

```
NURSING NOTE 0730

Pt seen this AM for am care. Roberts continues to do well post-op day 3.
States pain controlled with PCA, last bolus at 0612. Daughter (Margaret
Roberts-Hennessy) at bedside, stayed overnight. Spouse Henry called the
unit at 0445 from work and will visit this afternoon after his shift at
WakeMed Cary ends.

Vitals stable: BP 128/76, HR 82, T 98.4, RR 16, SpO2 97% RA. Incision C/D/I.
Foley draining clear yellow urine. Bowel sounds present in all 4 quads.
Tolerating clear liquids — advanced to soft diet at breakfast per Dr.
Okonkwo's order yesterday.

PT eval scheduled with Janet today; case management contacted re: discharge
planning, likely going home Friday with VNA. Insurance auth pending — see
note from Maria in case mgmt dated 4/21/25.

Hospital ID: WMH-2847-0419-A. Pager 919-555-0287. Email update sent to
attending at j.okonkwo@hospital.org.
```

**Expected hits:**
- Regex: dates, phone, email, vitals (likely ignored if not in label space), institution-specific ID (only if pattern added live during demo — good moment to demonstrate the custom-regex feature)
- Whitelist: Margaret Roberts-Hennessy, Henry, Janet, Maria, Dr. Okonkwo (depends on dictionary contents)
- Model: catches embedded names like "Roberts" (referring to the patient by surname only in the narrative), "Okonkwo"
- The "WMH-2847-0419-A" identifier is a perfect place to add a custom regex pattern live during the demo if you want to flex that feature

---

## Tips for using these in the demo

- **Paste, don't type.** Keep these on the clipboard or in a notes app — typos derail the flow.
- **Start with Note 1** to show the rules-only `clinical-fast` pipeline succeeding on the easy cases.
- **Switch to `clinical_trans`** and re-paste Note 1 — show the trace, point out it's basically the same output (model agrees with the rules on easy stuff).
- **Then paste Note 2** with `clinical_trans`. The model should catch names the rules missed. This is the "see, this is why we compose" moment.
- **Note 3 is optional.** Use it if a question comes up about edge cases, or if you want to demonstrate adding a custom regex live (the `WMH-...` identifier).
