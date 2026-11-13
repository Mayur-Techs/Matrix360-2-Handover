"""
Entry-point: python run.py
Launches Uvicorn + opens browser.
"""
import subprocess
import sys
import os
import time
import webbrowser
import threading

PORT = 8765

def open_browser():
    time.sleep(2.5)
    webbrowser.open(f"http://127.0.0.1:{PORT}")

if __name__ == "__main__":
    # Install playwright browsers if needed
    print("Checking Playwright browsers...")
    subprocess.run([sys.executable, "-m", "playwright", "install", "chromium"], check=False)
    
    print(f"\n[START] Lakhotia Industrial Lead Scraper -> http://127.0.0.1:{PORT}")
    print("   Press Ctrl+C to stop.\n")
    
    threading.Thread(target=open_browser, daemon=True).start()
    
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    
    import uvicorn
    uvicorn.run(
        "scraper.main:app",
        host="0.0.0.0",
        port=PORT,
        reload=False,
        log_level="info",
    )
