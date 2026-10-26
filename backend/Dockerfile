# VoxShield API. Needs about 4 GB of RAM at runtime (3.5 GB peak measured with all three models loaded).
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    HF_HOME=/opt/hf-cache

WORKDIR /srv
RUN useradd --system --uid 10001 --home-dir /srv voxshield

# CPU-only PyTorch: the default build bundles CUDA libraries and adds gigabytes the server can never use.
COPY requirements.txt .
RUN pip install --extra-index-url https://download.pytorch.org/whl/cpu -r requirements.txt

COPY app ./app
COPY scripts/download_models.py scripts/download_models.py

# Bake all three pinned models into the image, so a container never needs the network to answer a request.
RUN python scripts/download_models.py && chown -R voxshield:voxshield /opt/hf-cache

# Runtime defaults for a public server. Override any of them with environment variables.
ENV HF_HUB_OFFLINE=1 \
    HF_HUB_DISABLE_TELEMETRY=1 \
    VOXSHIELD_PRELOAD_MODELS=true \
    VOXSHIELD_DOCS_ENABLED=false \
    PORT=8000 \
    FORWARDED_ALLOW_IPS=127.0.0.1

USER voxshield
EXPOSE 8000

# Liveness only. The models keep loading for a while after start-up; /api/v1/ready reports when they are all loaded.
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
  CMD python -c "import os,urllib.request; urllib.request.urlopen('http://127.0.0.1:%s/api/v1/health' % os.environ['PORT'], timeout=4)"

# One worker on purpose: every extra worker would load its own copy of all three models.
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --workers 1 --proxy-headers"]
