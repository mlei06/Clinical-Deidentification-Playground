# Models Directory

**Local training and checkpoints** for detectors you want to use in pipelines belong here. Train or fine-tune on your machine (spaCy, HuggingFace, etc.), then drop artifacts into the layout below and reference them from pipe configuration once a loader pipe is wired to the manifest convention.

The directory structure groups models by their inference framework:

```
models/
  spacy/              # Models loaded via spacy.load()
    my-ner-model/
      model-best/     # spaCy model artifacts
      model_manifest.json
  huggingface/        # Models loaded via transformers AutoModel
    deid-roberta/
      config.json
      model.safetensors
      tokenizer.json
      model_manifest.json
  external/           # Models loaded via third-party libraries (e.g. Presidio)
    presidio-default/
      model_manifest.json
  neuroner/           # NeuroNER LSTM-CRF models (TF1 checkpoints)
    i2b2_2014_glove_spacy_bioes/
      dataset.pickle
      model.ckpt.*
      parameters.ini
      model_manifest.json
```

Each model directory **must** contain a `model_manifest.json` with at minimum:

```json
{
  "name": "my-model-name",
  "framework": "spacy",
  "labels": ["PATIENT", "DATE", "PHONE"]
}
```

The directory name must match the `name` field. Once a model is placed here with a valid manifest, it is immediately available for use in pipeline configs.
