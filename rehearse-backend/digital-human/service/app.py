import hashlib
import json
import logging
import os
import queue
import subprocess
import threading
import time
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

log = logging.getLogger("digital-human")

BASE = Path(__file__).resolve().parents[1]
STATE = Path(os.getenv("DH_STATE_DIR", BASE / "state-sun-hq"))
CLIPS = STATE / "clips"
JOBS = STATE / "jobs"
AUDIO = STATE / "audio"
LOGS = STATE / "logs"
POSTER = STATE / "poster.jpg"

_default_anchor = BASE / "assets/sun-anchor-720p.mp4"
if not _default_anchor.exists():
    _default_anchor = BASE / "third_party/MuseTalk/data/video/sun.mp4"
ANCHOR_VIDEO = Path(os.getenv("DH_ANCHOR_VIDEO", _default_anchor))
PIPER_MODEL = Path(
    os.getenv(
        "DH_PIPER_MODEL",
        BASE / "models/piper/en_US-lessac-high/en_US-lessac-high.onnx",
    )
)
PIPER_CONFIG = Path(
    os.getenv(
        "DH_PIPER_CONFIG",
        BASE / "models/piper/en_US-lessac-high/en_US-lessac-high.onnx.json",
    )
)
PIPER_BIN = Path(os.getenv("DH_PIPER_BIN", BASE / ".venv/bin/piper"))
RUN_DEMO = BASE / "scripts/run_demo.sh"

DEFAULT_VOICE = "en_US-lessac-high"
ENGINE_VERSION = "musetalk15-piper-lessac-high-v1"
QUEUE: queue.Queue[str] = queue.Queue()
MAX_QUEUE = int(os.getenv("DH_MAX_QUEUE", "500"))


def anchor_version(path: Path) -> str:
    try:
        stat = path.stat()
        return hashlib.sha256(
            f"{path.name}:{stat.st_size}:{stat.st_mtime_ns}".encode()
        ).hexdigest()[:10]
    except OSError:
        return "missing"


ANCHOR_VERSION = anchor_version(ANCHOR_VIDEO)


def ensure_poster() -> Path:
    try:
        anchor_mtime = ANCHOR_VIDEO.stat().st_mtime
    except OSError:
        return POSTER
    if POSTER.exists() and POSTER.stat().st_mtime >= anchor_mtime:
        return POSTER
    STATE.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-v",
            "error",
            "-ss",
            "3",
            "-i",
            str(ANCHOR_VIDEO),
            "-frames:v",
            "1",
            "-q:v",
            "2",
            str(POSTER),
        ],
        check=True,
        capture_output=True,
    )
    return POSTER


class ClipRequest(BaseModel):
    text: str = Field(min_length=1, max_length=1200)
    voice: str = Field(default=DEFAULT_VOICE, min_length=1, max_length=64)
    enqueue: bool = True


class ClipStatus(BaseModel):
    key: str
    status: Literal["missing", "queued", "processing", "ready", "failed"]
    url: str | None = None
    error: str | None = None
    queuePosition: int | None = None
    version: str | None = None


def now() -> int:
    return int(time.time())


def normalize_text(text: str) -> str:
    return " ".join(text.split())


def clip_key(text: str, voice: str) -> str:
    digest = hashlib.sha256()
    digest.update(ENGINE_VERSION.encode())
    digest.update(b"\0")
    digest.update(voice.encode())
    digest.update(b"\0")
    digest.update(text.encode())
    return digest.hexdigest()[:24]


def job_path(key: str) -> Path:
    return JOBS / f"{key}.json"


def clip_path(key: str) -> Path:
    return CLIPS / f"{key}.mp4"


def write_job(job: dict) -> None:
    JOBS.mkdir(parents=True, exist_ok=True)
    tmp = job_path(job["key"]).with_suffix(".tmp")
    tmp.write_text(json.dumps(job, ensure_ascii=False, indent=2))
    os.replace(tmp, job_path(job["key"]))


def read_job(key: str) -> dict | None:
    path = job_path(key)
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return None


def status_of(job: dict) -> ClipStatus:
    ready = clip_path(job["key"]).exists()
    status = "ready" if ready else job["status"]
    return ClipStatus(
        key=job["key"],
        status=status,
        url=f"/v1/clips/{job['key']}/video" if status == "ready" else None,
        error=None if status != "failed" else job.get("error"),
        version=ANCHOR_VERSION,
    )


def update_job(key: str, **fields) -> dict:
    job = read_job(key) or {"key": key}
    job.update(fields)
    job["updatedAt"] = now()
    write_job(job)
    return job


def enqueue(key: str) -> None:
    QUEUE.put(key)


def create_job(
    text: str, voice: str, force: bool = False, enqueue_job: bool = True
) -> ClipStatus:
    text = normalize_text(text)
    key = clip_key(text, voice)
    if clip_path(key).exists():
        return ClipStatus(
            key=key,
            status="ready",
            url=f"/v1/clips/{key}/video",
            version=ANCHOR_VERSION,
        )

    existing = read_job(key)
    if existing and not force:
        if existing["status"] in ("queued", "processing", "ready"):
            status = status_of(existing)
            status.queuePosition = None if status.status != "queued" else QUEUE.qsize() + 1
            return status

    if not enqueue_job:
        return ClipStatus(key=key, status="missing", version=ANCHOR_VERSION)

    job = {
        "key": key,
        "text": text,
        "voice": voice,
        "status": "queued",
        "error": None,
        "createdAt": existing.get("createdAt") if existing else now(),
        "updatedAt": now(),
    }
    write_job(job)
    enqueue(key)
    return ClipStatus(
        key=key,
        status="queued",
        queuePosition=QUEUE.qsize(),
        version=ANCHOR_VERSION,
    )


def synthesize(text: str, wav_path: Path) -> None:
    if not PIPER_MODEL.exists() or not PIPER_CONFIG.exists():
        raise RuntimeError(f"piper voice missing: {PIPER_MODEL}")
    wav_path.parent.mkdir(parents=True, exist_ok=True)
    result = subprocess.run(
        [
            str(PIPER_BIN),
            "-m",
            str(PIPER_MODEL),
            "-c",
            str(PIPER_CONFIG),
            "-f",
            str(wav_path),
            "--sentence-silence",
            "0.15",
        ],
        input=text,
        text=True,
        capture_output=True,
        timeout=120,
    )
    if result.returncode != 0 or not wav_path.exists():
        raise RuntimeError(f"piper failed: {result.stderr[-800:]}")


def render_video(key: str, wav_path: Path) -> Path:
    if not ANCHOR_VIDEO.exists():
        raise RuntimeError(f"anchor video missing: {ANCHOR_VIDEO}")
    result = subprocess.run(
        [str(RUN_DEMO), str(ANCHOR_VIDEO), str(wav_path), key],
        cwd=BASE,
        capture_output=True,
        text=True,
        timeout=900,
    )
    LOGS.mkdir(parents=True, exist_ok=True)
    (LOGS / f"{key}.log").write_text(result.stdout + "\n" + result.stderr)
    output = BASE / "outputs/demo/v15" / f"{key}.mp4"
    if result.returncode != 0 or not output.exists():
        raise RuntimeError(f"musetalk failed: {result.stderr[-800:]}")
    CLIPS.mkdir(parents=True, exist_ok=True)
    target = clip_path(key)
    fast = output.with_name(f"{key}-fast.mp4")
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-v",
            "warning",
            "-i",
            str(output),
            "-c",
            "copy",
            "-movflags",
            "+faststart",
            str(fast),
        ],
        check=True,
        capture_output=True,
    )
    os.replace(fast, output)
    os.replace(output, target)
    return target


def run_job(key: str) -> None:
    job = read_job(key)
    if not job:
        return
    update_job(key, status="processing", error=None)
    try:
        wav = AUDIO / f"{key}.wav"
        synthesize(job["text"], wav)
        render_video(key, wav)
        update_job(key, status="ready", error=None)
        log.info("clip ready %s", key)
    except Exception as exc:
        log.exception("clip failed %s", key)
        update_job(key, status="failed", error=str(exc)[:1000])


def worker() -> None:
    while True:
        key = QUEUE.get()
        try:
            run_job(key)
        finally:
            QUEUE.task_done()


def recover_jobs() -> None:
    JOBS.mkdir(parents=True, exist_ok=True)
    for path in sorted(JOBS.glob("*.json")):
        try:
            job = json.loads(path.read_text())
        except (OSError, ValueError):
            continue
        if job.get("status") in ("queued", "processing"):
            update_job(job["key"], status="queued")
            enqueue(job["key"])


app = FastAPI(title="Rehearse Digital Human", version="0.1.0")


@app.on_event("startup")
def startup() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    for path in (CLIPS, JOBS, AUDIO, LOGS):
        path.mkdir(parents=True, exist_ok=True)
    try:
        ensure_poster()
    except Exception:
        log.exception("poster generation failed")
    recover_jobs()
    threading.Thread(target=worker, name="musetalk-worker", daemon=True).start()


@app.get("/v1/health")
def health() -> dict:
    gpu = subprocess.run(
        ["nvidia-smi", "--query-gpu=name,memory.total", "--format=csv,noheader"],
        capture_output=True,
        text=True,
    )
    return {
        "ok": True,
        "engine": ENGINE_VERSION,
        "queue": QUEUE.qsize(),
        "anchor": str(ANCHOR_VIDEO),
        "anchorExists": ANCHOR_VIDEO.exists(),
        "piper": str(PIPER_MODEL),
        "piperExists": PIPER_MODEL.exists(),
        "poster": str(POSTER),
        "posterExists": POSTER.exists(),
        "gpu": gpu.stdout.strip() if gpu.returncode == 0 else None,
    }


@app.get("/v1/poster")
def get_poster() -> FileResponse:
    try:
        path = ensure_poster()
    except Exception as exc:
        raise HTTPException(status_code=500, detail="poster generation failed") from exc
    if not path.exists():
        raise HTTPException(status_code=404, detail="poster not found")
    return FileResponse(path, media_type="image/jpeg", filename="poster.jpg")


@app.post("/v1/clips", response_model=ClipStatus)
def create_clip(req: ClipRequest) -> ClipStatus:
    if not req.text.strip():
        raise HTTPException(status_code=400, detail="text is empty")
    if req.enqueue and QUEUE.qsize() >= MAX_QUEUE:
        raise HTTPException(status_code=429, detail="generation queue is full")
    return create_job(req.text, req.voice, enqueue_job=req.enqueue)


@app.get("/v1/clips/{key}", response_model=ClipStatus)
def get_clip(key: str) -> ClipStatus:
    job = read_job(key)
    if not job:
        raise HTTPException(status_code=404, detail="clip not found")
    return status_of(job)


@app.get("/v1/clips/{key}/video")
def get_clip_video(key: str) -> FileResponse:
    path = clip_path(key)
    if not path.exists():
        raise HTTPException(status_code=404, detail="clip not ready")
    return FileResponse(path, media_type="video/mp4", filename=f"{key}.mp4")


@app.post("/v1/clips/batch", response_model=list[ClipStatus])
def create_batch(reqs: list[ClipRequest]) -> list[ClipStatus]:
    if len(reqs) > 100:
        raise HTTPException(status_code=400, detail="at most 100 clips per batch")
    if QUEUE.qsize() + len(reqs) > MAX_QUEUE:
        raise HTTPException(status_code=429, detail="generation queue is full")
    return [create_job(req.text, req.voice) for req in reqs]


@app.post("/v1/queue/clear")
def clear_queue() -> dict:
    cleared = 0
    while True:
        try:
            QUEUE.get_nowait()
        except queue.Empty:
            break
        else:
            QUEUE.task_done()
            cleared += 1
    for path in JOBS.glob("*.json"):
        try:
            job = json.loads(path.read_text())
        except (OSError, ValueError):
            continue
        if job.get("status") in ("queued", "processing"):
            update_job(job["key"], status="failed", error="cancelled")
            cleared += 1
    return {"cleared": cleared}
