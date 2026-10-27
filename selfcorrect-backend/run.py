"""Start the API server:  python run.py"""
import os

import uvicorn

if __name__ == "__main__":
    from dotenv import load_dotenv

    load_dotenv()
    uvicorn.run(
        "app.main:app",
        host=os.getenv("HOST", "127.0.0.1"),
        port=int(os.getenv("PORT", "8000")),
        reload=os.getenv("RELOAD", "").lower() in ("1", "true", "yes"),
    )
