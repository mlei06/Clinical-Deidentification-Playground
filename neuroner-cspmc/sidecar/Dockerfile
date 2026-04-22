# NeuroNER LSTM-CRF inference sidecar (Python 3.7 + TensorFlow 1.x).
# Build from repository root: docker build -f neuroner-cspmc/sidecar/Dockerfile .
FROM python:3.7-slim-bullseye

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY neuroner-cspmc/requirements.txt neuroner-cspmc/constraints.txt /app/neuroner-cspmc/
RUN pip install --no-cache-dir -U "pip<24" \
    && pip install --no-cache-dir -c /app/neuroner-cspmc/constraints.txt \
        -r /app/neuroner-cspmc/requirements.txt

COPY neuroner-cspmc/ /app/neuroner-cspmc/

RUN python -m spacy download en

COPY neuroner-cspmc/sidecar/requirements-api.txt /app/requirements-api.txt
RUN pip install --no-cache-dir -r /app/requirements-api.txt

COPY neuroner-cspmc/sidecar/serve.py /app/serve.py

ENV NEURONER_ROOT=/app/neuroner-cspmc \
    PYTHONUNBUFFERED=1

EXPOSE 8765

CMD ["sh", "-c", "python -m uvicorn serve:app --host 0.0.0.0 --port ${NEURONER_HTTP_PORT:-8765}"]
