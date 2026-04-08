#!/usr/bin/env python
"""NeuroNER subprocess worker — runs under the Python 3.7 neuroner venv.

This script is launched as a child process by :class:`NeuroNerPipe`.  It loads
a NeuroNER model once, then services JSON-RPC requests on stdin/stdout.

Protocol (line-delimited JSON):
    -> {"action": "predict", "text": "..."}
    <- {"entities": [{"type": "DOCTOR", "start": 8, "end": 18, "text": "John Smith"}, ...]}
    -> {"action": "labels"}
    <- {"labels": ["AGE", "DOCTOR", ...]}
    -> {"action": "shutdown"}
    <- {"status": "ok"}

All neuroner / TensorFlow diagnostic output is redirected to stderr so it
never corrupts the JSON channel on stdout.
"""
from __future__ import print_function

import json
import os
import signal
import sys

# ── Redirect stdout before ANY neuroner/TF import ──────────────────────────
# NeuroNER and TensorFlow both print to stdout.  We capture the real stdout
# fd for our JSON-RPC channel and reroute sys.stdout to stderr.
_rpc_out = sys.stdout
sys.stdout = sys.stderr


def _extract_entity_labels(modeldata):
    """Return sorted entity label names (BIOES prefixes stripped, 'O' removed)."""
    raw = set()
    for label in modeldata.unique_labels:
        if label[:2] in ('B-', 'I-', 'E-', 'S-'):
            raw.add(label[2:])
    return sorted(raw)


def _send(obj):
    """Write a single JSON object + newline to the RPC channel."""
    _rpc_out.write(json.dumps(obj) + '\n')
    _rpc_out.flush()


def main():
    import argparse

    parser = argparse.ArgumentParser(description='NeuroNER JSON-RPC worker')
    parser.add_argument('--neuroner_root', required=True,
                        help='Path to neuroner-cspmc project root')
    parser.add_argument('--model_folder', required=True,
                        help='Path to pretrained model directory')
    parser.add_argument('--dataset_text_folder', required=True,
                        help='Path to dataset text folder (for tokenizer format)')
    parser.add_argument('--token_pretrained_embedding_filepath', required=True,
                        help='Path to pretrained token embeddings (GloVe)')
    parser.add_argument('--output_folder', required=False, default=None,
                        help='Path for output (defaults to neuroner_root/output)')
    args = parser.parse_args()

    # neuroner uses relative paths (./data/temp, ./output, etc.)
    os.chdir(args.neuroner_root)

    # Add neuroner to sys.path so imports resolve
    if args.neuroner_root not in sys.path:
        sys.path.insert(0, args.neuroner_root)

    # Now safe to import neuroner (all its prints go to stderr)
    from neuroner.neuromodel import NeuroNER

    nn_kwargs = dict(
        train_model=False,
        use_pretrained_model=True,
        pretrained_model_folder=args.model_folder,
        dataset_text_folder=args.dataset_text_folder,
        token_pretrained_embedding_filepath=args.token_pretrained_embedding_filepath,
    )
    if args.output_folder:
        nn_kwargs['output_folder'] = args.output_folder

    try:
        nn = NeuroNER(**nn_kwargs)
        nn.fit()
    except Exception as e:
        _send({'status': 'error', 'detail': str(e)})
        sys.exit(1)

    entity_labels = _extract_entity_labels(nn.modeldata)
    _send({'status': 'ready', 'labels': entity_labels})

    # ── Main request loop ──────────────────────────────────────────────────
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
        except json.JSONDecodeError:
            _send({'error': 'invalid_json', 'detail': 'Could not parse request'})
            continue

        action = request.get('action')

        if action == 'predict':
            text = request.get('text', '')
            if not text.strip():
                _send({'entities': []})
                continue
            try:
                entities = nn.predict(text)
                # entities: list of {'id': 'T1', 'type': 'DOCTOR', 'start': 8, 'end': 18, 'text': '...'}
                _send({'entities': entities})
            except Exception as e:
                _send({'error': 'predict_failed', 'detail': str(e)})

        elif action == 'labels':
            _send({'labels': entity_labels})

        elif action == 'shutdown':
            _send({'status': 'ok'})
            try:
                nn.close()
            except Exception:
                pass
            break

        else:
            _send({'error': 'unknown_action', 'detail': 'Unknown action: {}'.format(action)})


def _handle_signal(signum, frame):
    sys.exit(0)


if __name__ == '__main__':
    signal.signal(signal.SIGTERM, _handle_signal)
    signal.signal(signal.SIGINT, _handle_signal)
    main()
