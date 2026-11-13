# Production Dockerfile for Prompt-Driven Lead Research
FROM mcr.microsoft.com/playwright/python:v1.49.1-noble

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PORT=8012 \
    HOST=0.0.0.0

WORKDIR /app

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt && \
    playwright install chromium

# Copy application files
COPY app/ ./app/
COPY README.md .env.example ./

# Create data and output storage directories
RUN mkdir -p data output/jobs

EXPOSE 8012

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:${PORT:-8012}/health || exit 1

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8012}"]
