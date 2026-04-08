# NeuroNER Setup Guide

NeuroNER is an LSTM-CRF named entity recognizer used for clinical text de-identification. It requires **Python 3.7** because it depends on TensorFlow 1.x.

## Directory layout

All data and output live at the project root. The `neuroner-cspmc/` directory contains only the library code and its virtualenv.

```
neuroner-cspmc/              # Engine only — no data, no output
  neuroner/                  # Python package
  setup.py
  requirements.txt
  constraints.txt
  venv/                      # Python 3.7 virtualenv

data/
  word_vectors/              # GloVe embeddings
    glove.6B.100d.txt
  neuroner_deploy/           # Bootstrap deploy folder for inference pipe
    deploy/
      example.txt
  <your_dataset>/            # Training/eval datasets (BRAT format)
    train/ valid/ test/ deploy/

models/neuroner/             # Pretrained model checkpoints
  i2b2_2014_glove_spacy_bioes/
  mimic_glove_spacy_bioes/
  ...

output/neuroner/             # Training and inference output
```

## Automated Setup

```bash
chmod +x scripts/setup_neuroner.sh
./scripts/setup_neuroner.sh
```

This installs Python 3.7.12, creates the virtualenv, installs all dependencies, downloads pretrained models, and downloads GloVe embeddings.

## Manual Setup

### 1. Install pyenv (if not already installed)

```bash
# Install build dependencies (Ubuntu/Debian)
sudo apt install -y build-essential libssl-dev zlib1g-dev \
  libbz2-dev libreadline-dev libsqlite3-dev libffi-dev \
  liblzma-dev libncurses-dev tk-dev

# Install pyenv
curl https://pyenv.run | bash

# Add to shell profile (~/.bashrc or ~/.zshrc)
echo 'export PYENV_ROOT="$HOME/.pyenv"' >> ~/.bashrc
echo '[[ -d $PYENV_ROOT/bin ]] && export PATH="$PYENV_ROOT/bin:$PATH"' >> ~/.bashrc
echo 'eval "$(pyenv init --path)"' >> ~/.bashrc
echo 'eval "$(pyenv init -)"' >> ~/.bashrc
source ~/.bashrc
```

### 2. Install Python 3.7.12 and create virtualenv

```bash
pyenv install 3.7.12
$(pyenv prefix 3.7.12)/bin/python -m venv neuroner-cspmc/venv
```

### 3. Install dependencies

```bash
source neuroner-cspmc/venv/bin/activate
pip install --upgrade "pip<24"
pip install -c neuroner-cspmc/constraints.txt -r neuroner-cspmc/requirements.txt
```

The constraints file pins spaCy's C-extension dependencies to versions with pre-built wheels for Python 3.7 (without these, pip tries to compile from source and fails due to Cython incompatibilities).

### 4. Download spaCy English model

```bash
source neuroner-cspmc/venv/bin/activate
python -m spacy download en
```

### 5. Download pretrained models

Download from Google Drive:
**[Pretrained Models Folder](https://drive.google.com/drive/folders/1qKK4eTQgF2RWOfmBo_MvayUm0oY6uxOZ?usp=sharing)**

```bash
pip install gdown
gdown --folder "https://drive.google.com/drive/folders/1qKK4eTQgF2RWOfmBo_MvayUm0oY6uxOZ" -O models/neuroner/
```

Or download manually and place folders into `models/neuroner/`.

### 6. Download GloVe word embeddings

Download from Google Drive:
**[glove.6B.zip](https://drive.google.com/file/d/1_Dx5-S8GMivdWM4AXqE2PyUD_00DRpFY/view?usp=drive_link)**

```bash
mkdir -p data/word_vectors
gdown "1_Dx5-S8GMivdWM4AXqE2PyUD_00DRpFY" -O data/word_vectors/glove.6B.zip
unzip data/word_vectors/glove.6B.zip -d data/word_vectors/
rm data/word_vectors/glove.6B.zip
```

## Inference

### Standalone (via neuroner CLI)

```bash
source neuroner-cspmc/venv/bin/activate
cd neuroner-cspmc

neuroner --train_model=False \
         --use_pretrained_model=True \
         --pretrained_model_folder=../models/neuroner/i2b2_2014_glove_spacy_bioes \
         --dataset_text_folder=../data/neuroner_deploy \
         --token_pretrained_embedding_filepath=../data/word_vectors/glove.6B.100d.txt \
         --output_folder=../output/neuroner
```

Place `.txt` files in a `deploy/` subfolder of the dataset directory. Results are written to `output/neuroner/`.

### Via Clinical Deid pipeline

The `neuroner_ner` pipe automatically launches a Python 3.7 subprocess to bridge between the main Python 3.11+ environment and the NeuroNER TF1 runtime.

**Pipeline JSON:**
```json
{
  "pipes": [
    {
      "type": "neuroner_ner",
      "config": {
        "model": "i2b2_2014_glove_spacy_bioes"
      }
    },
    {
      "type": "span_resolver",
      "config": {"strategy": "longest"}
    }
  ]
}
```

Default paths assumed by the pipe (all relative to project root, configurable):

| Config field | Default | Description |
|---|---|---|
| `model` | `i2b2_2014_glove_spacy_bioes` | Model directory name |
| `models_dir` | `models/neuroner` | Parent directory for models |
| `neuroner_root` | `neuroner-cspmc` | Path to neuroner-cspmc engine |
| `venv_python` | `neuroner-cspmc/venv/bin/python` | Python 3.7 interpreter |
| `token_embedding` | `data/word_vectors/glove.6B.100d.txt` | GloVe embeddings |
| `dataset_text_folder` | `data/neuroner_deploy` | Bootstrap deploy folder |
| `output_folder` | `output/neuroner` | Output directory |

### Available models

| Model | Dataset | Tokenizer | Labels |
|-------|---------|-----------|--------|
| `i2b2_2014_glove_spacy_bioes` | i2b2 2014 De-id | spaCy | 23 PHI types |
| `i2b2_2014_glove_stanford_bioes` | i2b2 2014 De-id | Stanford CoreNLP | 23 PHI types |
| `mimic_glove_spacy_bioes` | MIMIC-III | spaCy | PHI types |
| `mimic_glove_stanford_bioes` | MIMIC-III | Stanford CoreNLP | PHI types |
| `conll_2003_en` | CoNLL 2003 | — | PER, LOC, ORG, MISC |

For clinical de-identification, **`i2b2_2014_glove_spacy_bioes`** is recommended (no Java dependency, trained on clinical data).

## Training

### Train and export (one command)

```bash
# Fine-tune on a BRAT corpus, export best epoch to models/neuroner/
./scripts/neuroner_train.sh my_model data/corpora/physionet/brat \
    --pretrained i2b2_2014_glove_spacy_bioes

# Train from scratch
./scripts/neuroner_train.sh my_model data/corpora/physionet/brat

# With custom training params
./scripts/neuroner_train.sh my_model data/corpora/physionet/brat \
    --pretrained i2b2_2014_glove_spacy_bioes \
    --patience 50 --epochs 200
```

This runs training, finds the best epoch by validation F1, and exports a pipeline-ready model to `models/neuroner/my_model/` with a `model_manifest.json`.

### Corpus format

Corpora in `data/corpora/<name>/brat/` must have BRAT-format subdirectories:

```
data/corpora/my_corpus/brat/
  train/          # Required: .txt and .ann files
  valid/          # Required: .txt and .ann files
  test/           # Optional: .txt and .ann files
```

Each document has a `.txt` file and a corresponding `.ann` file (BRAT standoff format):
```
T1	PATIENT 0 10	John Smith
T2	DATE 45 55	01/15/2024
T3	HOSPITAL 68 88	Mount Sinai Hospital
```

### Exporting a specific epoch

If you want to export a particular epoch from a previous training run instead of the best:

```bash
python scripts/neuroner_export.py \
    --training-output output/neuroner/<run_dir> \
    --model-name my_model \
    --epoch 42
```

### What gets exported

```
models/neuroner/my_model/
  model.ckpt.data-00000-of-00001   # TF checkpoint (best epoch)
  model.ckpt.index
  model.ckpt.meta
  checkpoint                        # TF checkpoint pointer
  dataset.pickle                    # Vocabulary and label mappings
  parameters.ini                    # Training hyperparameters
  model_manifest.json               # Pipeline metadata
```

The model is immediately usable in pipelines:
```json
{"type": "neuroner_ner", "config": {"model": "my_model"}}
```

### TensorBoard monitoring

```bash
tensorboard --logdir=output/neuroner
# Open http://127.0.0.1:6006
```

## Troubleshooting

**`pip install` fails with Cython errors on spaCy dependencies:**
Ensure you're using the constraints file: `pip install -c neuroner-cspmc/constraints.txt -r neuroner-cspmc/requirements.txt`

**`ModuleNotFoundError: No module named 'tensorflow'` in Python 3.11+:**
NeuroNER requires Python 3.7. Use the venv at `neuroner-cspmc/venv/bin/python`, not the system Python.

**Stanford tokenizer models fail:**
The `*_stanford_*` models require a running CoreNLP server. Use `*_spacy_*` models instead.

**`neuroner` command not found:**
Ensure the venv is activated (`source neuroner-cspmc/venv/bin/activate`) or use `python -m neuroner`.

**Subprocess timeout when using `neuroner_ner` pipe:**
Model loading takes 30-60s on first call. Increase `startup_timeout` in the pipe config if needed.
