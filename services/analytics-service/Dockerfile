# Analytics service (FastAPI). Self-contained Python — no shared TS libs, so the
# build context is this directory.
#   docker build -t iots-analytics services/analytics-service
FROM python:3.12-slim
WORKDIR /app
ENV PYTHONUNBUFFERED=1

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

EXPOSE 3003
CMD ["python", "-m", "app.main"]
