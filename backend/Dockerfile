FROM python:3.12-slim

WORKDIR /app

# Install dependencies first (better layer caching)
COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

# Copy backend source + the three frontend web apps
COPY backend ./backend
COPY frontend ./frontend

WORKDIR /app/backend
ENV FRONTEND_DIR=/app/frontend

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]