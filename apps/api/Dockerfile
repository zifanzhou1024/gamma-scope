FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app/apps/api:/app/services/collector

WORKDIR /app

RUN python -m pip install --no-cache-dir --upgrade pip

COPY apps/api/pyproject.toml apps/api/pyproject.toml
COPY apps/api/gammascope_api apps/api/gammascope_api
COPY packages/contracts/fixtures packages/contracts/fixtures
COPY services/collector/gammascope_collector services/collector/gammascope_collector

RUN python -m pip install --no-cache-dir ./apps/api moomoo-api pandas

EXPOSE 8000

CMD ["python", "-m", "uvicorn", "gammascope_api.main:app", "--app-dir", "apps/api", "--host", "0.0.0.0", "--port", "8000"]
