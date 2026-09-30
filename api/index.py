"""
Vercel Serverless Entrypoint for SmartFridge AI.
Guaranteed to import and run with zero-failure fallbacks.
"""

import sys
import os
import traceback
from pathlib import Path

# Add both api directory and project root to sys.path
API_DIR = Path(__file__).resolve().parent
ROOT_DIR = API_DIR.parent

for p in [str(API_DIR), str(ROOT_DIR)]:
    if p not in sys.path:
        sys.path.insert(0, p)

# Try importing server app
app = None
try:
    import server
    app = server.app
except Exception as e1:
    try:
        from . import server
        app = server.app
    except Exception as e2:
        print(f"Error importing server: {e1} | {e2}")
        from fastapi import FastAPI
        from fastapi.responses import JSONResponse
        
        app = FastAPI(title="SmartFridge AI Fallback")
        err_detail = f"Import error: {traceback.format_exc()}"
        
        @app.api_route("/{full_path:path}", methods=["GET", "POST", "PUT", "DELETE"])
        def fallback_handler(full_path: str):
            return JSONResponse(
                status_code=500,
                content={"status": "error", "message": "Serverless import error", "detail": err_detail}
            )
