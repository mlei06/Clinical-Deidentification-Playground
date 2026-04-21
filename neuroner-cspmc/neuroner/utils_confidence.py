# MIT License — same as NeuroNER
"""Map token-level softmax confidence (predicted label probability) onto BRAT entities."""
from __future__ import print_function


def token_char_offsets(text, tokens):
    """Approximate (start, end) character span for each token in *text*."""
    offsets = []
    pos = 0
    for tok in tokens:
        if not tok:
            offsets.append((pos, pos))
            continue
        j = text.find(tok, pos)
        if j < 0:
            j = text.find(tok)
        if j < 0:
            offsets.append((pos, pos))
            continue
        offsets.append((j, j + len(tok)))
        pos = j + len(tok)
    return offsets


def attach_confidence_to_entities(text, entities, tokens, token_conf_floats):
    """Set ``entity['confidence']`` to mean softmax prob over tokens overlapping the span.

    Modifies *entities* in place. If overlap cannot be determined, sets ``confidence`` to None.
    """
    if not entities or not tokens or not token_conf_floats:
        for ent in entities:
            ent["confidence"] = None
        return
    if len(tokens) != len(token_conf_floats):
        for ent in entities:
            ent["confidence"] = None
        return
    offsets = token_char_offsets(text, tokens)
    for ent in entities:
        es, ee = int(ent["start"]), int(ent["end"])
        idxs = []
        for ti, (ts, te) in enumerate(offsets):
            if te <= es or ts >= ee:
                continue
            idxs.append(ti)
        if not idxs:
            ent["confidence"] = None
        else:
            vals = [token_conf_floats[i] for i in idxs]
            ent["confidence"] = sum(vals) / float(len(vals))
