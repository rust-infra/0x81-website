#!/usr/bin/env python3
"""墨言 SQLite 库的热备 + 上传 Google Cloud Storage。

设计要点
- **纯标准库**：不装 pip 包、不装 gcloud/gsutil/rclone。服务账号的 RS256 签名借宿主已有的
  `openssl dgst -sha256 -sign` 完成，再用 `urllib` 走 GCS JSON API 上传。
- **热备**：用 python3 内置 sqlite3 的 backup API 从正在被后端写入的库做一致性快照，
  **不需要停 moyan-backend**（快照完成后再对快照跑 `PRAGMA integrity_check`，不 ok 就放弃上传）。
- **上传后校验**：比对本地 gzip 的 MD5（base64）与 GCS 返回的 `md5Hash` 及字节数，不一致即报错。
- **保留策略**：本地与云端各自按天数清理（云端清理也可以在桶上配 Object Lifecycle，二选一）。
- 上传失败**保留本地文件**并返回非 0，下次运行会补传（对象名里带时间戳，不会互相覆盖）。

配置（优先级：命令行 > 环境变量 > 默认值）
  --db / MOYAN_BACKUP_DB             默认 /data/moyan-data/moyan.db
  --key / MOYAN_BACKUP_KEY           服务账号 JSON 密钥，默认 /root/.gcs-moyan-backup.json
  --bucket / MOYAN_BACKUP_BUCKET     GCS 桶名（不设 = 只做本地备份，不上传）
  --prefix / MOYAN_BACKUP_PREFIX    对象名前缀，默认 moyan-db/
  --local-dir / MOYAN_BACKUP_LOCAL_DIR   本地暂存目录，默认 /var/backups/moyan
  --keep-days / MOYAN_BACKUP_KEEP_DAYS        云端保留天数，默认 30（0 = 不清理）
  --local-keep-days / MOYAN_BACKUP_LOCAL_KEEP_DAYS 本地保留天数，默认 7

用法
  backup-moyan-db.py                     # 正常备份（有桶就上传）
  backup-moyan-db.py --no-upload         # 只做本地热备（演练/自检用）
  backup-moyan-db.py --selftest          # 自检：临时密钥签一个 JWT 并用 openssl 验签
  backup-moyan-db.py --bucket X --keep-days 30 --local-keep-days 7
"""

from __future__ import annotations

import argparse
import base64
import gzip
import hashlib
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

GCS_API = "https://storage.googleapis.com"
GCS_UPLOAD_API = "https://storage.googleapis.com/upload"
SCOPE = "https://www.googleapis.com/auth/devstorage.read_write"
DEFAULT_KEY = "/root/.gcs-moyan-backup.json"
DEFAULT_DB = "/data/moyan-data/moyan.db"
DEFAULT_LOCAL_DIR = "/var/backups/moyan"
DEFAULT_PREFIX = "moyan-db/"


def log(message: str) -> None:
    print(f"[{datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')}] {message}", flush=True)


def b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


# ── 服务账号 / OAuth ────────────────────────────────────────────────


def load_service_account(path: str) -> dict:
    with open(path, "r", encoding="utf-8") as handle:
        key = json.load(handle)
    missing = [f for f in ("client_email", "private_key") if not key.get(f)]
    if missing:
        raise SystemExit(f"{path} 不是有效的服务账号 JSON：缺少 {', '.join(missing)}")
    key.setdefault("token_uri", "https://oauth2.googleapis.com/token")
    return key


def sign_rs256(message: bytes, private_key_pem: str) -> bytes:
    """用 openssl CLI 做 RS256 签名（避免依赖 cryptography/pyjwt）。"""
    with tempfile.TemporaryDirectory(prefix="moyan-key-") as tmp:
        key_path = os.path.join(tmp, "key.pem")
        # 0600：私钥只在这一次签名期间以文件形式存在
        fd = os.open(key_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(private_key_pem)
        result = subprocess.run(
            ["openssl", "dgst", "-sha256", "-sign", key_path],
            input=message,
            capture_output=True,
        )
        if result.returncode != 0:
            raise SystemExit(
                "openssl 签名失败：" + result.stderr.decode("utf-8", "replace").strip()
            )
        return result.stdout


def jwt_assertion(key: dict, lifetime_seconds: int = 3600) -> str:
    now = int(time.time())
    header = {"alg": "RS256", "typ": "JWT"}
    claims = {
        "iss": key["client_email"],
        "scope": SCOPE,
        "aud": key["token_uri"],
        "iat": now,
        "exp": now + lifetime_seconds,
    }
    signing_input = (
        b64url(json.dumps(header, separators=(",", ":")).encode())
        + "."
        + b64url(json.dumps(claims, separators=(",", ":")).encode())
    ).encode()
    signature = sign_rs256(signing_input, key["private_key"])
    return signing_input.decode() + "." + b64url(signature)


def access_token(key: dict) -> str:
    body = urllib.parse.urlencode(
        {
            "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
            "assertion": jwt_assertion(key),
        }
    ).encode()
    request = urllib.request.Request(
        key["token_uri"],
        data=body,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.loads(response.read().decode())["access_token"]
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", "replace")
        raise SystemExit(f"取 access token 失败（HTTP {error.code}）：{detail}")


# ── GCS JSON API ───────────────────────────────────────────────────


def gcs_request(token: str, url: str, method: str = "GET", data: bytes | None = None,
                content_type: str | None = None) -> dict:
    headers = {"Authorization": f"Bearer {token}"}
    if content_type:
        headers["Content-Type"] = content_type
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            payload = response.read()
            return json.loads(payload.decode()) if payload else {}
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", "replace")
        raise SystemExit(f"GCS {method} {url} 失败（HTTP {error.code}）：{detail}")


def upload_object(token: str, bucket: str, name: str, blob: bytes) -> dict:
    query = urllib.parse.urlencode({"uploadType": "media", "name": name})
    url = f"{GCS_UPLOAD_API}/storage/v1/b/{urllib.parse.quote(bucket, safe='')}/o?{query}"
    return gcs_request(token, url, method="POST", data=blob, content_type="application/gzip")


def list_objects(token: str, bucket: str, prefix: str) -> list[dict]:
    query = urllib.parse.urlencode(
        {"prefix": prefix, "fields": "items(name,timeCreated,size)", "maxResults": "1000"}
    )
    url = f"{GCS_API}/storage/v1/b/{urllib.parse.quote(bucket, safe='')}/o?{query}"
    return gcs_request(token, url).get("items", [])


def delete_object(token: str, bucket: str, name: str) -> None:
    url = (
        f"{GCS_API}/storage/v1/b/{urllib.parse.quote(bucket, safe='')}"
        f"/o/{urllib.parse.quote(name, safe='')}"
    )
    gcs_request(token, url, method="DELETE")


# ── 备份本体 ───────────────────────────────────────────────────────


def hot_snapshot(db_path: str, dest_path: str) -> None:
    """用 sqlite backup API 从运行中的库取一致性快照。"""
    source = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True, timeout=60)
    try:
        target = sqlite3.connect(dest_path)
        try:
            source.backup(target)
        finally:
            target.close()
    finally:
        source.close()


def verify_snapshot(path: str) -> None:
    connection = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=30)
    try:
        result = connection.execute("PRAGMA integrity_check").fetchone()[0]
    finally:
        connection.close()
    if result != "ok":
        raise SystemExit(f"快照完整性检查失败：{result}")


def prune(directory: str, keep_days: int) -> int:
    removed = 0
    for entry in os.listdir(directory):
        path = os.path.join(directory, entry)
        if entry.startswith("moyan-") and entry.endswith(".db.gz"):
            if keep_days > 0 and os.path.getmtime(path) < time.time() - keep_days * 86400:
                os.remove(path)
                removed += 1
        elif entry.startswith(".moyan-") and entry.endswith(".db"):
            # 上次运行崩在中途留下的临时快照，超过一天就清掉
            if os.path.getmtime(path) < time.time() - 86400:
                os.remove(path)
    return removed


def prune_remote(token: str, bucket: str, prefix: str, keep_days: int) -> int:
    if keep_days <= 0:
        return 0
    cutoff = datetime.now(timezone.utc) - timedelta(days=keep_days)
    removed = 0
    for item in list_objects(token, bucket, prefix):
        created = item.get("timeCreated")
        if not created:
            continue
        created_at = datetime.fromisoformat(created.replace("Z", "+00:00"))
        if created_at < cutoff:
            delete_object(token, bucket, item["name"])
            log(f"删除云端旧对象 {item['name']}（{created}）")
            removed += 1
    return removed


def selftest() -> int:
    """不联网的自检：临时 RSA 密钥签 JWT，再用对应公钥验签。"""
    with tempfile.TemporaryDirectory(prefix="moyan-selftest-") as tmp:
        key_path = os.path.join(tmp, "test.key")
        pub_path = os.path.join(tmp, "test.pub")
        subprocess.run(
            ["openssl", "genrsa", "-out", key_path, "2048"], check=True, capture_output=True
        )
        subprocess.run(
            ["openssl", "rsa", "-in", key_path, "-pubout", "-out", pub_path],
            check=True,
            capture_output=True,
        )
        with open(key_path, "r", encoding="utf-8") as handle:
            pem = handle.read()
        token = jwt_assertion(
            {
                "client_email": "selftest@example.iam.gserviceaccount.com",
                "private_key": pem,
                "token_uri": "https://oauth2.googleapis.com/token",
            }
        )
        header, claims, signature = token.split(".")
        signing_input = f"{header}.{claims}".encode()
        raw_signature = base64.urlsafe_b64decode(signature + "=" * (-len(signature) % 4))
        signature_path = os.path.join(tmp, "signature.bin")
        with open(signature_path, "wb") as handle:
            handle.write(raw_signature)
        # 用公钥独立验一遍 JWT 签名：与 GCS 侧校验的是同一段字节
        result = subprocess.run(
            ["openssl", "dgst", "-sha256", "-verify", pub_path, "-signature", signature_path],
            input=signing_input,
            capture_output=True,
        )
        decoded = json.loads(base64.urlsafe_b64decode(claims + "=" * (-len(claims) % 4)))
        ok = result.returncode == 0
        log(f"自检：JWT 声明 aud={decoded['aud']} scope={decoded['scope']}")
        log(f"自检：RS256 验签 {'通过' if ok else '失败'}")
        return 0 if ok else 1


def main() -> int:
    parser = argparse.ArgumentParser(description="墨言 SQLite 热备 + 上传 GCS")
    parser.add_argument("--db", default=os.environ.get("MOYAN_BACKUP_DB", DEFAULT_DB))
    parser.add_argument("--key", default=os.environ.get("MOYAN_BACKUP_KEY", DEFAULT_KEY))
    parser.add_argument("--bucket", default=os.environ.get("MOYAN_BACKUP_BUCKET", ""))
    parser.add_argument(
        "--prefix", default=os.environ.get("MOYAN_BACKUP_PREFIX", DEFAULT_PREFIX)
    )
    parser.add_argument(
        "--local-dir",
        default=os.environ.get("MOYAN_BACKUP_LOCAL_DIR", DEFAULT_LOCAL_DIR),
    )
    parser.add_argument(
        "--keep-days", type=int, default=int(os.environ.get("MOYAN_BACKUP_KEEP_DAYS", "30"))
    )
    parser.add_argument(
        "--local-keep-days",
        type=int,
        default=int(os.environ.get("MOYAN_BACKUP_LOCAL_KEEP_DAYS", "7")),
    )
    parser.add_argument("--no-upload", action="store_true", help="只做本地热备")
    parser.add_argument("--selftest", action="store_true", help="本地自检（不备份、不联网）")
    args = parser.parse_args()

    if args.selftest:
        return selftest()

    if not os.path.exists(args.db):
        raise SystemExit(f"找不到数据库：{args.db}")

    os.makedirs(args.local_dir, mode=0o700, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    snapshot = os.path.join(args.local_dir, f".moyan-{stamp}.db")  # 临时，压缩后删
    name = f"moyan-{stamp}.db.gz"
    archive = os.path.join(args.local_dir, name)

    log(f"热备 {args.db} → {name}")
    hot_snapshot(args.db, snapshot)
    verify_snapshot(snapshot)
    size = os.path.getsize(snapshot)
    with open(snapshot, "rb") as src, gzip.GzipFile(archive, "wb", compresslevel=9, mtime=0) as dst:
        shutil.copyfileobj(src, dst)
    os.remove(snapshot)
    os.chmod(archive, 0o600)  # 库里有用户邮箱/昵称等个人信息，备份不放宽权限
    with open(archive, "rb") as handle:
        blob = handle.read()
    local_md5 = base64.b64encode(hashlib.md5(blob).digest()).decode()
    log(f"快照 {size} 字节 → gzip {len(blob)} 字节，md5(base64)={local_md5}")

    removed_local = prune(args.local_dir, args.local_keep_days)
    if removed_local:
        log(f"清理本地旧备份 {removed_local} 个（保留 {args.local_keep_days} 天）")

    if args.no_upload or not args.bucket:
        if not args.bucket and not args.no_upload:
            log("未配置桶（--bucket / MOYAN_BACKUP_BUCKET）→ 只保留本地备份")
        log("完成（未上传）")
        return 0

    if not os.path.exists(args.key):
        log(f"缺少服务账号密钥 {args.key} → 本次只保留本地备份 {archive}")
        return 1

    token = access_token(load_service_account(args.key))
    object_name = f"{args.prefix.rstrip('/')}/{name}"
    result = upload_object(token, args.bucket, object_name, blob)

    remote_md5 = result.get("md5Hash")
    remote_size = int(result.get("size", -1))
    if remote_md5 != local_md5 or remote_size != len(blob):
        raise SystemExit(
            f"上传校验失败：本地 md5={local_md5} size={len(blob)}，"
            f"云端 md5={remote_md5} size={remote_size}"
        )
    log(f"已上传 gs://{args.bucket}/{object_name}（md5 与字节数校验通过）")

    removed_remote = prune_remote(token, args.bucket, args.prefix, args.keep_days)
    if removed_remote:
        log(f"清理云端旧对象 {removed_remote} 个（保留 {args.keep_days} 天）")
    log("完成")
    return 0


if __name__ == "__main__":
    sys.exit(main())
