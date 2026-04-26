FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app/apps/api

WORKDIR /app

COPY apps/api ./apps/api
COPY packages/contracts/fixtures ./packages/contracts/fixtures

RUN pip install --no-cache-dir ./apps/api

EXPOSE 8000

CMD ["sh", "-c", "uvicorn gammascope_api.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
