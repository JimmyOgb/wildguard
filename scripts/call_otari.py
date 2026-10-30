"""
WildGuard - Diagnostic Smoke Test Script
Sends a single smoke-test chat completion request to the Otari gateway.
Requires OTARI_API_KEY exported in environment or present in root .env.
Safe: Zero hardcoded secrets, read-only verification.
"""

import os
import sys
import json
import urllib.request
import urllib.error

# Ensure output encoding is utf-8
if sys.stdout.encoding.lower() != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8')

api_key = os.environ.get("OTARI_API_KEY")
if not api_key:
    # Try reading from root .env if present
    repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    env_path = os.path.join(repo_root, ".env")
    if os.path.exists(env_path):
        with open(env_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line.startswith("OTARI_API_KEY=") and len(line) > len("OTARI_API_KEY="):
                    val = line[len("OTARI_API_KEY="):].strip().strip('"').strip("'")
                    if val:
                        api_key = val
                        break

if not api_key:
    print("ERROR: OTARI_API_KEY is not set in your environment.", file=sys.stderr)
    sys.exit(1)

url = "https://api.otari.ai/api/v1/chat/completions"
headers = {
    "Otari-Key": api_key,
    "Content-Type": "application/json",
    "User-Agent": "WildGuard-SmokeTest/1.0"
}

body = {
    "model": "alibaba/qwen-3.5-35b-a3b",
    "messages": [
        {"role": "user", "content": "Hello"}
    ]
}

data = json.dumps(body).encode("utf-8")
req = urllib.request.Request(url, data=data, headers=headers, method="POST")

try:
    with urllib.request.urlopen(req) as response:
        res_data = response.read().decode("utf-8")
        parsed = json.loads(res_data)
        choices = parsed.get("choices", [])
        if choices:
            reply = choices[0].get("message", {}).get("content", "")
            print(reply)
        else:
            print("No choices returned:", parsed)
except urllib.error.HTTPError as e:
    err_body = e.read().decode("utf-8", errors="ignore")
    print(f"HTTP Error {e.code}: {e.reason}", file=sys.stderr)
    print(err_body, file=sys.stderr)
    sys.exit(e.code)
except Exception as e:
    print(f"Error calling Otari: {e}", file=sys.stderr)
    sys.exit(1)
