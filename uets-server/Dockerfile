FROM python:3.13-slim

WORKDIR /app

# Install uv
RUN pip install --no-cache-dir uv

# Copy requirements first for better caching
COPY requirements.txt .

# Install dependencies
RUN uv pip install --system -r requirements.txt

# Copy application code
COPY main.py .

# Create volume mount points for persistent data
VOLUME ["/app/data"]

# Set environment variables
ENV DATA_FILE=/app/data/quiz_data.json
ENV BLACKLIST_FILE=/app/data/ip_blacklist.json
ENV PYTHONUNBUFFERED=1

# Expose port
EXPOSE 5000

# Run with gunicorn for production
CMD ["gunicorn", "-w", "4", "-k", "eventlet", "-b", "0.0.0.0:5000", "--access-logfile", "-", "--error-logfile", "-", "main:app"]