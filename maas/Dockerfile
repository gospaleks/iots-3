# MaaS — Model-as-a-Service (Phase 4).
# Ships the trained artifact IN the image; model loads once at startup, never
# trained at boot. features.py is imported verbatim by both train.py and app.py
# (D4: single shared transform → no train/serve skew).
#
# Build context is this directory:
#   docker build -t iots-maas maas/
FROM python:3.12-slim
WORKDIR /app
ENV PYTHONUNBUFFERED=1 \
    MODEL_PATH=/models/model.joblib \
    MODEL_META_PATH=/models/model_meta.json \
    MAAS_PORT=8000

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY features.py app.py ./
# Ship the artifact in the image — Phase 4 acceptance: no training at boot.
COPY models/model.joblib models/model_meta.json models/metrics.json /models/

EXPOSE 8000
# Shell form so ${MAAS_PORT} is expanded at container start.
CMD uvicorn app:app --host 0.0.0.0 --port ${MAAS_PORT}
