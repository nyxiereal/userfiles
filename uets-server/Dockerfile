FROM ghcr.io/astral-sh/uv:debian AS builder

WORKDIR /app

# Copy requirements first for better caching
COPY requirements.txt .

# Install dependencies into a virtual environment
RUN uv venv /app/.venv && \
    uv pip install --python /app/.venv/bin/python -r requirements.txt

# Final stage
FROM ghcr.io/astral-sh/uv:debian

WORKDIR /app

# Copy virtual environment from builder
COPY --from=builder /app/.venv /app/.venv

# Copy application code
COPY main.py .

# Create volume mount points for persistent data
VOLUME ["/app/data"]

# Set environment variables
ENV DATA_FILE=/app/data/quiz_data.json
ENV BLACKLIST_FILE=/app/data/ip_blacklist.json
ENV PYTHONUNBUFFERED=1
ENV PATH="/app/.venv/bin:$PATH"

# Expose port
EXPOSE 5000

# Run with gunicorn for production
CMD ["gunicorn", "-w", "4", "-k", "eventlet", "-b", "0.0.0.0:5000", "--access-logfile", "-", "--error-logfile", "-", "main:app"]