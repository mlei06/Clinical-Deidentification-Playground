# Demo Script

**Length:** ~15 min. Stage directions in *italics*.

---

## Pre-demo checklist

- [ ] Backend up on EC2
- [ ] Playground UI running, pointed at EC2
- [ ] Production UI running, inference-only key
- [ ] Fine-tuned BERT model present
- [ ] A clinical eval dataset registered
- [ ] A short, realistic clinical note on clipboard (names, dates, MRN, phone)
- [ ] Browser zoomed for the back row

---

## 1. Opening (45 sec)

This project is a platform for building and deploying custom NER pipelines. NER — named-entity recognition — is the task of pulling out the things that matter from a piece of text: names, dates, identifiers, that kind of thing. It shows up under the hood of a lot of useful tools — redacting documents, structuring records, generating training data, search.

The reason I built this is that most NER setups rely on a single tool, and a single tool always has gaps. Regex misses unusual cases. A model misses things outside its training data. A dictionary only knows what you put in it. This platform is built around combining them, so the pieces cover for each other.

---

## 2. The pipeline idea (1.5 min)

*Open the Playground UI, then the Create view.*

This is the authoring view. A pipeline is an ordered list of *pipes*, and each pipe is one way of finding entities — regex, dictionaries, ML models, LLMs. Each one is good at different things. Regex is precise on structured patterns like phone numbers but useless on names. A model handles names well but is inconsistent on rare identifiers. A dictionary of a hospital's staff is near-perfect for the names that actually show up in their notes, but it doesn't generalize.

The point of the platform is that you don't have to pick one. You stack them, and you get to configure each one in detail without writing code.

For this demo I'll build a clinical de-identification pipeline. The reason this use case matters: hospitals have huge amounts of clinical text — notes, discharge summaries, EHR fields — and most of it can't be shared or used to train models because it contains protected health information. The data that would be most useful for clinical NLP is the data that's locked up. Reliable de-identification is what makes that data usable.

---

## 3. Build `clinical-fast` (3 min)

*Drop in a regex_ner pipe.*

Starting with regex. In the config you can see the full label space the pipe targets — these are the HIPAA Safe Harbor categories. Expanding a label shows the bundled patterns. I can toggle individual patterns off, or add my own inline — so an institution-specific MRN format goes right here. There's also a label-mapping field if I want to rename what this pipe outputs.

Regex is good at structured identifiers. It won't find names, so I need more pipes.

*Add a whitelist pipe. Pop into Dictionaries briefly.*

This is the dictionaries view. You upload term lists and assign them to labels. In production, a hospital uploads their staff directory once, and from then on you have a strong detector for the names that actually appear in their notes.

*Back to the pipeline. Add a blacklist pipe.*

Blacklist is the inverse — terms you know are *not* what you're looking for. Common drug names that look like people, that kind of thing. It's the cleanup pass.

*Save the pipeline as `clinical-fast`.*

I'll save this as `clinical-fast`. No ML in this one — just rules and dictionaries. Runs in milliseconds. It's a solid baseline but it'll miss anything the rules don't anticipate.

---

## 4. Build `clinical_trans` (1 min)

*Load clinical-fast, add a huggingface_ner pipe, pick the BERT model.*

Now I'll add a model on top. I fine-tuned a BERT encoder on clinical data, so it's seen the kind of language in real notes. The platform picks up models from the models directory automatically.

*Save as `clinical_trans`.*

Save this as `clinical_trans`. Same baseline as before, plus the model.

---

## 5. Inference (1.5 min)

*Open Inference, paste the prepared note.*

This is where you test pipelines. Paste in some text, pick a pipeline, see the output. I'll run `clinical-fast` first.

*Run it.*

Spans are highlighted by label. Over here is the trace — which pipe found which span, how long each one took. This is the loop I use when I'm iterating.

*Switch to clinical_trans, run the same input.*

Same input through `clinical_trans`. Notice the extra spans — the unusual name the rules missed, picked up by the model. The trace shows the model adds latency, which is the tradeoff.

---

## 6. Datasets (1 min)

*Open the Datasets view.*

Datasets get their own view. Each one shows label distribution and document counts. There are transforms for slicing and remapping, and you can upload your own — JSONL or BRAT. Anything here can be used for evaluation or training.

The BERT model I just used was trained on MIMIC and PhysioNet data, brought in this way.

---

## 7. Evaluation (1.5 min)

*Open the Evaluate view.*

This is where you find out if a pipeline is actually any good. I'll pull up runs for both pipelines on the same gold dataset.

Standard metrics here — precision, recall, F1 — but the per-label view is more useful, because for de-id not all labels matter equally. Missing a date is annoying. Missing a name is a HIPAA violation. The platform reports coverage weighted by sensitivity, so you're not just optimizing for average accuracy.

You can also compare two pipelines directly, which is how I decide whether a change is an improvement or just a different set of mistakes.

---

## 8. Deploy (30 sec)

*Open the Deploy view.*

When a pipeline is good enough, you assign it to a *mode*. That's what makes it reachable from outside this admin UI. Pipelines that aren't deployed aren't available.

*Deploy clinical_trans to a mode.*

---

## 9. Production UI (45 sec)

*Switch to the Production UI.*

This is a separate UI, but it's hitting the exact same backend as the Playground. The difference is how it authenticates. The Playground I've been using authenticates with an admin key — full access to authoring, datasets, dictionaries, the audit log, everything. This one authenticates with an inference-only key. It can run pipelines that have been deployed to a mode, and that's it. It can't see or edit pipelines, can't touch dictionaries, can't read the audit log.

So one backend, two scoped views: the Playground for the people building and tuning pipelines, the Production UI for the people actually using them.

---

## 10. Hospital workflow (3 min)

Here's the workflow this enables, and this is the use case that motivated most of the platform.

A hospital has thousands of clinical notes. They contain useful information for research and for training models, but they also contain PHI, so they're locked down. De-identifying by hand is too expensive. Trusting a single automated tool isn't safe enough.

*Paste a clinical note into the Production UI.*

A reviewer pastes in a note — or in production, uploads a batch.

*Run it through the deployed pipeline.*

The pipeline tags every piece of PHI it can find. Because we composed multiple detectors, recall is higher than any single one would give.

*Walk through the review UI.*

Then a human reviews — accepts, edits, or rejects each span. The pipeline does most of the work; the reviewer catches the edge cases.

*Apply surrogates. Show before/after.*

The last step replaces every PHI span with realistic fake data — names that read like names, dates that read like dates, all fictional. The clinical content stays; the identifiers are gone.

The output is a fully annotated, fully de-identified document. Safe to share, safe to publish, safe to train on.

---

## 11. Closing the loop (45 sec)

*Back to the Playground, open Datasets.*

And the new dataset shows up right here, in the same view we saw earlier.

So now I can use it to evaluate other pipelines, train the next version of the model, or run new pipelines over it. The output of the platform feeds back into the platform.

That's the basic idea: build pipelines, deploy them, use them to turn text you can't share into data you can, and use that data to build better pipelines.

---

## Wrap (15 sec)

That's the demo. Questions?

---

## Cut list (if running long)

1. Blacklist pipe walkthrough
2. Transforms in Datasets
3. Live custom-regex edit
4. Eval comparison view

## If something breaks

- Backend unreachable → `curl $BACKEND/health`
- Model missing from dropdown → `POST /models/refresh`
- Production UI auth fails → wrong key scope
