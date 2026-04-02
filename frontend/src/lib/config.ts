/// Shared configuration constants for the frontend application.

/// Base URL for the Python FastAPI backend service.
/// Override via VITE_PYTHON_SERVICE_URL environment variable.
export const PYTHON_SERVICE_URL =
  import.meta.env.VITE_PYTHON_SERVICE_URL ?? "http://localhost:8000";
