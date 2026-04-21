#!/usr/bin/env bash
# =============================================================================
# Train a NeuroNER model on a BRAT corpus and export it to models/neuroner/
#
# Usage:
#   ./scripts/neuroner_train.sh <model_name> <corpus_path> [options]
#
# Examples:
#   # Train from scratch on a corpus
#   ./scripts/neuroner_train.sh my_model data/corpora/physionet/brat
#
#   # Fine-tune a pretrained model
#   ./scripts/neuroner_train.sh my_finetuned data/corpora/physionet/brat \
#       --pretrained i2b2_2014_glove_spacy_bioes
#
#   # With custom training params
#   ./scripts/neuroner_train.sh my_model data/corpora/physionet/brat \
#       --patience 50 --epochs 200
#
# The corpus directory must contain train/ and valid/ subdirectories with
# BRAT-format .txt and .ann files. A test/ subdirectory is optional.
#
# By default, NeuroNER's generated files (train_spacy.txt, *_bioes.txt, …) are
# written under output/neuroner/dataset_staging/<corpus_basename>/ — symlinks to
# your BRAT train/valid/test — so data/corpora/ stays free of those artifacts.
# Use --no-staging to pass the corpus path directly to NeuroNER (legacy behavior).
#
# Output:
#   models/neuroner/<model_name>/
#     model.ckpt.*           TF checkpoint (best epoch)
#     dataset.pickle         Vocabulary and label mappings
#     parameters.ini         Training hyperparameters
#     checkpoint             TF checkpoint pointer
#     model_manifest.json    Metadata for pipeline integration
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
NEURONER_ROOT="$PROJECT_ROOT/neuroner-cspmc"
VENV_PYTHON="$NEURONER_ROOT/venv/bin/python"
MODELS_DIR="$PROJECT_ROOT/models/neuroner"
OUTPUT_DIR="$PROJECT_ROOT/output/neuroner"
EMBED_FILE="$PROJECT_ROOT/data/word_vectors/glove.6B.100d.txt"

# ── Parse arguments ─────────────────────────────────────────────────────────

usage() {
    echo "Usage: $0 <model_name> <corpus_path> [options]"
    echo ""
    echo "Options:"
    echo "  --pretrained <name>   Fine-tune from a pretrained model in models/neuroner/"
    echo "  --patience <n>        Epochs without improvement before early stop (default: 10)"
    echo "  --epochs <n>          Maximum training epochs (default: 100)"
    echo "  --eval-mode <mode>    Evaluation mode: conll|token|binary (default: token)"
    echo "  --embedding <path>    Path to token embeddings (default: data/word_vectors/glove.6B.100d.txt)"
    echo "  --description <text>  Description for model manifest"
    echo "  --staging-dir <path>  NeuroNER working dir (default: output/neuroner/dataset_staging/<corpus_basename>)"
    echo "  --no-staging          Use corpus path as dataset_text_folder (writes *_spacy.txt into corpus)"
    exit 1
}

if [ $# -lt 2 ]; then usage; fi

MODEL_NAME="$1"; shift
CORPUS_PATH="$1"; shift

PRETRAINED=""
PATIENCE=10
MAX_EPOCHS=100
EVAL_MODE="token"
DESCRIPTION=""
STAGING_DIR=""
USE_STAGING=1

while [ $# -gt 0 ]; do
    case "$1" in
        --pretrained)   PRETRAINED="$2"; shift 2 ;;
        --patience)     PATIENCE="$2"; shift 2 ;;
        --epochs)       MAX_EPOCHS="$2"; shift 2 ;;
        --eval-mode)    EVAL_MODE="$2"; shift 2 ;;
        --embedding)    EMBED_FILE="$2"; shift 2 ;;
        --description)  DESCRIPTION="$2"; shift 2 ;;
        --staging-dir)  STAGING_DIR="$2"; shift 2 ;;
        --no-staging)   USE_STAGING=0; shift ;;
        *) echo "Unknown option: $1"; usage ;;
    esac
done

# Relative --staging-dir is anchored to project root
if [ -n "$STAGING_DIR" ]; then
    case "$STAGING_DIR" in
        /*) ;;
        *) STAGING_DIR="$PROJECT_ROOT/$STAGING_DIR" ;;
    esac
fi

# ── Validate ────────────────────────────────────────────────────────────────

info()  { echo -e "\033[1;34m[INFO]\033[0m  $*"; }
ok()    { echo -e "\033[1;32m[OK]\033[0m    $*"; }
error() { echo -e "\033[1;31m[ERROR]\033[0m $*"; exit 1; }

CORPUS_PATH="$(cd "$CORPUS_PATH" 2>/dev/null && pwd)" || error "Corpus not found: $CORPUS_PATH"

[ -x "$VENV_PYTHON" ] || error "NeuroNER venv not found. Run: ./scripts/setup_neuroner.sh"
[ -f "$EMBED_FILE" ]   || error "Embeddings not found: $EMBED_FILE"
[ -d "$CORPUS_PATH/train" ] || error "Corpus missing train/ subdirectory: $CORPUS_PATH"
[ -d "$CORPUS_PATH/valid" ] || error "Corpus missing valid/ subdirectory: $CORPUS_PATH"

if [ -d "$MODELS_DIR/$MODEL_NAME" ]; then
    error "Model '$MODEL_NAME' already exists at $MODELS_DIR/$MODEL_NAME"
fi

if [ -n "$PRETRAINED" ] && [ ! -d "$MODELS_DIR/$PRETRAINED" ]; then
    error "Pretrained model not found: $MODELS_DIR/$PRETRAINED"
fi

# ── NeuroNER dataset folder (staging keeps generated *_spacy.txt out of corpora/) ─

if [ "$USE_STAGING" -eq 1 ]; then
    if [ -z "$STAGING_DIR" ]; then
        STAGING_DIR="$OUTPUT_DIR/dataset_staging/$(basename "$CORPUS_PATH")"
    fi
    info "NeuroNER working directory (generated CoNLL/spaCy files): $STAGING_DIR"
    rm -rf "$STAGING_DIR"
    mkdir -p "$STAGING_DIR"
    for split in train valid; do
        ln -sfn "$CORPUS_PATH/$split" "$STAGING_DIR/$split"
    done
    if [ -d "$CORPUS_PATH/test" ]; then
        ln -sfn "$CORPUS_PATH/test" "$STAGING_DIR/test"
    fi
    DATASET_TEXT_FOLDER="$STAGING_DIR"
else
    info "Using corpus in-place as NeuroNER dataset_text_folder (may write *_spacy.txt under corpus)"
    DATASET_TEXT_FOLDER="$CORPUS_PATH"
fi

# ── Build neuroner command ──────────────────────────────────────────────────

NEURONER_ARGS=(
    --train_model=True
    --dataset_text_folder="$DATASET_TEXT_FOLDER"
    --token_pretrained_embedding_filepath="$EMBED_FILE"
    --output_folder="$OUTPUT_DIR"
    --patience="$PATIENCE"
    --maximum_number_of_epochs="$MAX_EPOCHS"
    --main_evaluation_mode="$EVAL_MODE"
)

if [ -n "$PRETRAINED" ]; then
    NEURONER_ARGS+=(
        --use_pretrained_model=True
        --pretrained_model_folder="$MODELS_DIR/$PRETRAINED"
    )
    info "Fine-tuning from: $PRETRAINED"
else
    NEURONER_ARGS+=(--use_pretrained_model=False)
    info "Training from scratch"
fi

info "Model name:  $MODEL_NAME"
info "Corpus:      $CORPUS_PATH"
info "Output:      $OUTPUT_DIR"
info "Patience:    $PATIENCE"
info "Max epochs:  $MAX_EPOCHS"
echo ""

# ── Train ───────────────────────────────────────────────────────────────────

cd "$NEURONER_ROOT"
"$VENV_PYTHON" -m neuroner "${NEURONER_ARGS[@]}"

# ── Find the training output directory ──────────────────────────────────────
# neuroner creates: output/<dataset_basename>_<timestamp>/model/

LATEST_RUN=$(ls -td "$OUTPUT_DIR"/*/ 2>/dev/null | head -1)
if [ -z "$LATEST_RUN" ] || [ ! -d "$LATEST_RUN/model" ]; then
    error "Could not find training output in $OUTPUT_DIR"
fi

info "Training output: $LATEST_RUN"

# ── Export best model ───────────────────────────────────────────────────────

cd "$PROJECT_ROOT"
# Same interpreter as training: dataset.pickle unpickles NeuroNER classes (not loadable from the main app venv).
"$VENV_PYTHON" scripts/neuroner_export.py \
    --training-output "$LATEST_RUN" \
    --model-name "$MODEL_NAME" \
    --models-dir "$MODELS_DIR" \
    --description "$DESCRIPTION" \
    ${PRETRAINED:+--base-model "$PRETRAINED"}

ok "Model exported to: $MODELS_DIR/$MODEL_NAME"
echo ""
echo "To use in a pipeline:"
echo '  {"type": "neuroner_ner", "config": {"model": "'"$MODEL_NAME"'"}}'
echo ""
