#!/usr/bin/env python3
import os
import sys
import time
from pathlib import Path

try:
    import requests
    from requests.adapters import HTTPAdapter
    from urllib3.util.retry import Retry
except ImportError:
    print("[E] Missing dependency: requests. Install with: pip install requests[socks]")
    sys.exit(1)

UA = (
    "Mozilla/5.0 (X11; Linux x86_64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/120.0 Safari/537.36"
)

# Proxy candidates: env HF_PROXY first, then socks5h and http on 7890
ENV_PROXY = os.environ.get("HF_PROXY", "").strip()
PROXY_CANDIDATES = [p for p in [ENV_PROXY, "socks5h://127.0.0.1:7890", "http://127.0.0.1:7890"] if p]

# Files to download (relative path -> URL)
# Note: vocab.txt is not needed for this model (SentencePiece tokenizer, vocab in tokenizer.json)
# Note: onnx/config.json does not exist for this model
FILES = {
    "tokenizer.json": "https://huggingface.co/Xenova/paraphrase-multilingual-MiniLM-L12-v2/resolve/main/tokenizer.json",
    "tokenizer_config.json": "https://huggingface.co/Xenova/paraphrase-multilingual-MiniLM-L12-v2/resolve/main/tokenizer_config.json",
    "special_tokens_map.json": "https://huggingface.co/Xenova/paraphrase-multilingual-MiniLM-L12-v2/resolve/main/special_tokens_map.json",
    "config.json": "https://huggingface.co/Xenova/paraphrase-multilingual-MiniLM-L12-v2/resolve/main/config.json",
    "onnx/model_quantized.onnx": "https://huggingface.co/Xenova/paraphrase-multilingual-MiniLM-L12-v2/resolve/main/onnx/model_quantized.onnx",
}

FALLBACK_ONNX = {
    "onnx/model.onnx": "https://huggingface.co/Xenova/paraphrase-multilingual-MiniLM-L12-v2/resolve/main/onnx/model.onnx",
}

# Optional mirror base (rewrite huggingface.co to hf-mirror.com)
def to_mirror(url: str) -> str:
    return url.replace("https://huggingface.co/", "https://hf-mirror.com/")

TIMEOUT = (15, 300)
CHUNK = 1 << 20


def ensure_dir(path: Path):
    path.mkdir(parents=True, exist_ok=True)


def build_session(proxy: str | None):
    s = requests.Session()
    s.headers.update({"User-Agent": UA})
    if proxy:
        s.proxies = {"http": proxy, "https": proxy}
    retries = Retry(total=5, backoff_factor=1.0, status_forcelist=[429, 502, 503, 504], allowed_methods=["GET"])
    s.mount("https://", HTTPAdapter(max_retries=retries))
    s.mount("http://", HTTPAdapter(max_retries=retries))
    return s


def try_download_with(session, url: str, dest: Path) -> bool:
    try:
        with session.get(url, stream=True, timeout=TIMEOUT) as r:
            r.raise_for_status()
            tmp = dest.with_suffix(dest.suffix + ".tmp")
            start = time.time()
            downloaded = 0
            with open(tmp, "wb") as f:
                for chunk in r.iter_content(CHUNK):
                    if chunk:
                        f.write(chunk)
                        downloaded += len(chunk)
            os.replace(tmp, dest)
            print(f"[I] Saved {dest} ({downloaded / (1024*1024):.2f} MB) in {time.time() - start:.1f}s")
            return True
    except requests.exceptions.SSLError as e:
        print(f"[W] SSL error for {url}: {e}")
        return False
    except requests.exceptions.RequestException as e:
        print(f"[W] Request failed for {url}: {e}")
        return False


def download(url: str, dest: Path) -> bool:
    # Try each proxy candidate, then mirror without proxy
    for proxy in PROXY_CANDIDATES:
        print(f"[I] Trying proxy: {proxy}")
        session = build_session(proxy)
        if try_download_with(session, url, dest):
            return True
        # If direct URL failed, try mirror URL via same proxy
        mirror_url = to_mirror(url)
        print("[I] Trying mirror: hf-mirror.com")
        if try_download_with(session, mirror_url, dest):
            return True
    # Finally try without proxy using mirror
    print("[I] Trying without proxy on mirror")
    nop_session = build_session(None)
    if try_download_with(nop_session, to_mirror(url), dest):
        return True
    return False


def main():
    base = Path.cwd()
    ensure_dir(base / "onnx")

    print(f"[I] Proxy candidates: {', '.join(PROXY_CANDIDATES) or 'None'}")

    for rel, url in FILES.items():
        dest = base / rel
        if dest.exists() and dest.stat().st_size > 0:
            print(f"[I] Skip existing: {rel}")
            continue
        ensure_dir(dest.parent)
        ok = download(url, dest)
        if not ok:
            if rel == "onnx/model_quantized.onnx":
                fb_rel, fb_url = next(iter(FALLBACK_ONNX.items()))
                fb_dest = base / fb_rel
                print("[I] Trying fallback ONNX: model.onnx")
                ensure_dir(fb_dest.parent)
                if not download(fb_url, fb_dest):
                    print("[E] Fallback ONNX also failed.")
                    sys.exit(2)
            else:
                print("[E] Abort due to download error.")
                sys.exit(2)

    print("[I] All files present.")
    print("[I] You can set localModelDir to this assets directory in plugin config.")


if __name__ == "__main__":
    main()
