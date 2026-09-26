#!/usr/bin/env python3
"""墨言 SQLite 库的热备 + 上传 Google Drive。

为什么是 Drive + 用户 OAuth（而不是服务账号密钥 / 自建 OIDC 签发者）
- 不下载服务账号密钥（Google 明确不推荐：长期、可移植、泄露后可在 GCP 里横向使用）。
- 不自建 OIDC 签发者：普通 VPS 上没有真实工作负载身份，WIF 只是"把 Google 凭据换成一把
  自建签名私钥"，本机照样要长期保存一个秘密，却多出两个公网端点。
- 用你自己的 Google 账号做一次**设备码授权**（服务器打印 URL+码，你在自己设备上点同意），
  之后本机只保存一枚 **refresh token**：作用域限 `drive.file`（只能看/管本应用创建的文件）、
  可在 Google 账号里随时一键撤销、不做任何 GCP 资源级授权。

配置（优先级：命令行 > 环境变量 > 默认值）
  --db / MOYAN_BACKUP_DB                 默认 /data/moyan-data/moyan.db
  --oauth-file / MOYAN_BACKUP_OAUTH_FILE 凭据文件，默认 /etc/moyan-backup/google-oauth.json
                                         （存 client_id / client_secret / refresh_token，0600）
  --drive-folder / MOYAN_BACKUP_DRIVE_FOLDER  Drive 里的目标文件夹名，默认 moyan-backups
  --local-dir / MOYAN_BACKUP_LOCAL_DIR   本地暂存，默认 /var/backups/moyan
  --keep-days / MOYAN_BACKUP_KEEP_DAYS   云端（Drive 文件夹内）保留天数，默认 30；0 = 不清理
  --local-keep-days / MOYAN_BACKUP_LOCAL_KEEP_DAYS 本地保留天数，默认 7

用法
  backup-moyan-db.py --authorize         # 一次性授权（打印 URL+码，轮询等待你同意）
  backup-moyan-db.py                     # 正常备份（热备 → gzip → 上传 → 校验 → 清理）
  backup-moyan-db.py --no-upload         # 只做本地热备（演练）
  backup-moyan-db.py --check             # 自检：刷新令牌 + 查 Drive 账号信息（不上传）
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
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timedelta, timezone

DEVICE_CODE_URL = "https://oauth2.googleapis.com/device/code"
TOKEN_URL = "https://oauth2.googleapis.com/token"
DRIVE_API = "https://www.googleapis.com/drive/v3"
DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3/files"
SCOPE = "https://www.googleapis.com/auth/drive.file"
FOLDER_MIME = "application/vnd.google-apps.folder"

DEFAULT_DB = "/data/moyan-data/moyan.db"
DEFAULT_OAUTH_FILE = "/etc/moyan-backup/google-oauth.json"
DEFAULT_LOCAL_DIR = "/var/backups/moyan"
DEFAULT_FOLDER = "moyan-backups"


def log(message: str) -> None:
    # stderr：stdout 留给可能被管道消费的数据输出
    print(
        f"[{datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')}] {message}",
        file=sys.stderr,
        flush=True,
    )


# ── OAuth（设备码流程 + refresh token） ────────────────────────────


def load_credentials(path: str) -> dict:
    if not os.path.exists(path):
        raise SystemExit(
            f"缺少凭据文件 {path}：先按 README 建 OAuth 客户端，"
            "再用 `backup-moyan-db.py --authorize` 授权"
        )
    with open(path, "r", encoding="utf-8") as handle:
        return json.load(handle)


def save_credentials(path: str, credentials: dict) -> None:
    os.makedirs(os.path.dirname(path), mode=0o700, exist_ok=True)
    temporary = f"{path}.tmp"
    with open(temporary, "w", encoding="utf-8") as handle:
        json.dump(credentials, handle, indent=2)
    os.chmod(temporary, 0o600)
    os.replace(temporary, path)


def post_form(url: str, fields: dict, timeout: int = 30) -> dict:
    body = urllib.parse.urlencode(fields).encode()
    request = urllib.request.Request(
        url, data=body, headers={"Content-Type": "application/x-www-form-urlencoded"}
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode())
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", "replace")
        try:
            return {"__http_error__": error.code, **json.loads(detail)}
        except json.JSONDecodeError:
            raise SystemExit(f"{url} 失败（HTTP {error.code}）：{detail}")


def authorize(path: str, client_id: str, client_secret: str) -> int:
    """设备码流程：打印 URL + 用户码，轮询到同意后落盘 refresh token。"""
    if not client_id or not client_secret:
        raise SystemExit(
            "先在 Google Cloud 建 OAuth 客户端（类型：电视和受限输入设备），"
            "然后把 client_id / client_secret 填进凭据文件（或用 --client-id/--client-secret 传）"
        )
    device = post_form(DEVICE_CODE_URL, {"client_id": client_id, "scope": SCOPE})
    if "device_code" not in device:
        raise SystemExit(f"申请设备码失败：{json.dumps(device, ensure_ascii=False)}")

    log("请在任意设备的浏览器里打开下面地址，并输入用户码：")
    log(f"  URL      : {device['verification_url']}")
    log(f"  用户码    : {device['user_code']}")
    log(f"  有效期    : {device['expires_in']} 秒")
    log("同意后本脚本会自动继续（正在轮询…）")

    interval = int(device.get("interval", 5))
    deadline = time.time() + int(device.get("expires_in", 1800))
    while time.time() < deadline:
        time.sleep(interval)
        result = post_form(
            TOKEN_URL,
            {
                "client_id": client_id,
                "client_secret": client_secret,
                "device_code": device["device_code"],
                "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
            },
        )
        if result.get("refresh_token"):
            credentials = {
                "client_id": client_id,
                "client_secret": client_secret,
                "refresh_token": result["refresh_token"],
                "scope": result.get("scope", SCOPE),
                "authorized_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            }
            save_credentials(path, credentials)
            log(f"授权成功，凭据已写入 {path}（0600）")
            return 0
        error = result.get("error")
        if error == "authorization_pending":
            continue
        if error == "slow_down":
            interval += 5
            continue
        raise SystemExit(f"授权失败：{json.dumps(result, ensure_ascii=False)}")
    raise SystemExit("设备码过期，请重新运行 --authorize")


def access_token(credentials: dict, path: str) -> str:
    result = post_form(
        TOKEN_URL,
        {
            "client_id": credentials["client_id"],
            "client_secret": credentials["client_secret"],
            "refresh_token": credentials["refresh_token"],
            "grant_type": "refresh_token",
        },
    )
    if result.get("access_token"):
        return result["access_token"]
    error = result.get("error")
    if error == "invalid_grant":
        raise SystemExit(
            "refresh token 已失效（invalid_grant）。常见原因：\n"
            "  1) OAuth 应用仍处于「测试」状态 —— Google 规定测试态的 refresh token 7 天过期；\n"
            "     把应用发布为「生产」（无需提交审核，仅首次授权会多一个未验证应用提示）即可长期有效；\n"
            f"  2) 应用被删除/密钥被重置/在账号里撤销了授权。\n"
            f"重新授权：backup-moyan-db.py --authorize（凭据文件 {path}）"
        )
    raise SystemExit(f"刷新令牌失败：{json.dumps(result, ensure_ascii=False)}")


# ── Drive API ──────────────────────────────────────────────────────


def drive_request(token: str, url: str, method: str = "GET", data: bytes | None = None,
                  content_type: str | None = None) -> dict:
    headers = {"Authorization": f"Bearer {token}"}
    if content_type:
        headers["Content-Type"] = content_type
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=180) as response:
            payload = response.read()
            return json.loads(payload.decode()) if payload else {}
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", "replace")
        raise SystemExit(f"Drive API {method} {url} 失败（HTTP {error.code}）：{detail}")


def ensure_folder(token: str, name: str) -> str:
    query = urllib.parse.urlencode(
        {
            "q": f"name = '{name}' and mimeType = '{FOLDER_MIME}' and trashed = false",
            "fields": "files(id,name)",
        }
    )
    existing = drive_request(token, f"{DRIVE_API}/files?{query}").get("files", [])
    if existing:
        return existing[0]["id"]
    metadata = json.dumps({"name": name, "mimeType": FOLDER_MIME}).encode()
    created = drive_request(
        token,
        f"{DRIVE_API}/files?fields=id,name",
        method="POST",
        data=metadata,
        content_type="application/json",
    )
    log(f"已在 Drive 里创建文件夹「{name}」")
    return created["id"]


def upload_file(token: str, folder_id: str, name: str, blob: bytes) -> dict:
    """multipart/related 简单上传：元数据 + 文件体一次请求。"""
    boundary = f"moyan-{uuid.uuid4().hex}"
    metadata = json.dumps({"name": name, "parents": [folder_id]}).encode()
    body = b"".join(
        [
            f"--{boundary}\r\n".encode(),
            b"Content-Type: application/json; charset=UTF-8\r\n\r\n",
            metadata,
            b"\r\n",
            f"--{boundary}\r\n".encode(),
            b"Content-Type: application/gzip\r\n\r\n",
            blob,
            b"\r\n",
            f"--{boundary}--\r\n".encode(),
        ]
    )
    url = f"{DRIVE_UPLOAD}?uploadType=multipart&fields=id,name,size,md5Checksum,createdTime"
    return drive_request(
        token, url, method="POST", data=body,
        content_type=f"multipart/related; boundary={boundary}",
    )


def list_backups(token: str, folder_id: str) -> list[dict]:
    query = urllib.parse.urlencode(
        {
            "q": f"'{folder_id}' in parents and name contains 'moyan-' and trashed = false",
            "fields": "files(id,name,size,createdTime)",
            "orderBy": "createdTime desc",
            "pageSize": "1000",
        }
    )
    return drive_request(token, f"{DRIVE_API}/files?{query}").get("files", [])


def prune_drive(token: str, folder_id: str, keep_days: int) -> int:
    if keep_days <= 0:
        return 0
    cutoff = datetime.now(timezone.utc) - timedelta(days=keep_days)
    removed = 0
    for item in list_backups(token, folder_id):
        created = item.get("createdTime")
        if not created:
            continue
        created_at = datetime.fromisoformat(created.replace("Z", "+00:00"))
        if created_at < cutoff:
            drive_request(token, f"{DRIVE_API}/files/{item['id']}", method="DELETE")
            log(f"删除云端旧备份 {item['name']}（{created}）")
            removed += 1
    return removed


def drive_about(token: str) -> dict:
    fields = "user(displayName,emailAddress),storageQuota(limit,usage)"
    return drive_request(token, f"{DRIVE_API}/about?fields={urllib.parse.quote(fields)}")


# ── 备份本体 ───────────────────────────────────────────────────────


def hot_snapshot(db_path: str, dest_path: str) -> None:
    """用 sqlite backup API 从运行中的库取一致性快照（不需要停后端）。"""
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


def prune_local(directory: str, keep_days: int) -> int:
    removed = 0
    for entry in os.listdir(directory):
        path = os.path.join(directory, entry)
        if entry.startswith("moyan-") and entry.endswith(".db.gz"):
            if keep_days > 0 and os.path.getmtime(path) < time.time() - keep_days * 86400:
                os.remove(path)
                removed += 1
        elif entry.startswith(".moyan-") and entry.endswith(".db"):
            # 上次崩在中途留下的临时快照，超过一天清掉
            if os.path.getmtime(path) < time.time() - 86400:
                os.remove(path)
    return removed


def main() -> int:
    parser = argparse.ArgumentParser(description="墨言 SQLite 热备 + 上传 Google Drive")
    parser.add_argument("--db", default=os.environ.get("MOYAN_BACKUP_DB", DEFAULT_DB))
    parser.add_argument(
        "--oauth-file",
        default=os.environ.get("MOYAN_BACKUP_OAUTH_FILE", DEFAULT_OAUTH_FILE),
    )
    parser.add_argument(
        "--drive-folder",
        default=os.environ.get("MOYAN_BACKUP_DRIVE_FOLDER", DEFAULT_FOLDER),
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
    parser.add_argument("--authorize", action="store_true", help="一次性设备码授权")
    parser.add_argument("--check", action="store_true", help="自检：刷新令牌 + 查 Drive 信息")
    parser.add_argument("--no-upload", action="store_true", help="只做本地热备")
    parser.add_argument(
        "--require-upload",
        action="store_true",
        default=os.environ.get("MOYAN_BACKUP_REQUIRE_UPLOAD", "") not in ("", "0", "false"),
        help="已授权后打开：缺少凭据/上传失败都算失败（未授权阶段留空，避免每天报红）",
    )
    # 授权时用（一般写在凭据文件里，这里允许临时覆盖）
    parser.add_argument("--client-id", default=os.environ.get("MOYAN_BACKUP_CLIENT_ID", ""))
    parser.add_argument(
        "--client-secret", default=os.environ.get("MOYAN_BACKUP_CLIENT_SECRET", "")
    )
    args = parser.parse_args()

    if args.authorize:
        stored = {}
        if os.path.exists(args.oauth_file):
            with open(args.oauth_file, "r", encoding="utf-8") as handle:
                stored = json.load(handle)
        return authorize(
            args.oauth_file,
            args.client_id or stored.get("client_id", ""),
            args.client_secret or stored.get("client_secret", ""),
        )

    if not os.path.exists(args.db):
        raise SystemExit(f"找不到数据库：{args.db}")

    if args.check:
        credentials = load_credentials(args.oauth_file)
        token = access_token(credentials, args.oauth_file)
        info = drive_about(token)
        user = info.get("user", {})
        quota = info.get("storageQuota", {})
        limit = int(quota.get("limit", 0)) / 1024 ** 3
        usage = int(quota.get("usage", 0)) / 1024 ** 3
        log(f"令牌可用：{user.get('emailAddress')}（{user.get('displayName')}）")
        log(f"Drive 配额：已用 {usage:.2f} GB / {limit:.2f} GB")
        log(f"备份文件夹：{args.drive_folder}")
        return 0

    os.makedirs(args.local_dir, mode=0o700, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    snapshot = os.path.join(args.local_dir, f".moyan-{stamp}.db")
    name = f"moyan-{stamp}.db.gz"
    archive = os.path.join(args.local_dir, name)

    log(f"热备 {args.db} → {name}")
    hot_snapshot(args.db, snapshot)
    verify_snapshot(snapshot)
    size = os.path.getsize(snapshot)
    with open(snapshot, "rb") as src, gzip.GzipFile(
        archive, "wb", compresslevel=9, mtime=0
    ) as dst:
        shutil.copyfileobj(src, dst)
    os.remove(snapshot)
    os.chmod(archive, 0o600)  # 库里有用户邮箱/昵称等个人信息
    with open(archive, "rb") as handle:
        blob = handle.read()
    local_md5 = hashlib.md5(blob).hexdigest()
    log(f"快照 {size} 字节 → gzip {len(blob)} 字节，md5={local_md5}")

    removed_local = prune_local(args.local_dir, args.local_keep_days)
    if removed_local:
        log(f"清理本地旧备份 {removed_local} 个（保留 {args.local_keep_days} 天）")

    if args.no_upload:
        log("完成（未上传）")
        return 0

    if not os.path.exists(args.oauth_file):
        level = "失败" if args.require_upload else "警告"
        log(
            f"{level}：尚未授权（缺 {args.oauth_file}）→ 本次只保留本地备份 {archive}。"
            "云上传请先按 README 建 OAuth 客户端并跑 --authorize"
        )
        return 1 if args.require_upload else 0

    credentials = load_credentials(args.oauth_file)
    token = access_token(credentials, args.oauth_file)
    folder_id = ensure_folder(token, args.drive_folder)
    result = upload_file(token, folder_id, name, blob)

    remote_md5 = result.get("md5Checksum")
    remote_size = int(result.get("size", -1))
    if remote_md5 != local_md5 or remote_size != len(blob):
        raise SystemExit(
            f"上传校验失败：本地 md5={local_md5} size={len(blob)}，"
            f"云端 md5={remote_md5} size={remote_size}"
        )
    log(
        f"已上传 Drive：{args.drive_folder}/{name}"
        f"（md5 与字节数校验通过，文件 id={result.get('id')}）"
    )

    removed_remote = prune_drive(token, folder_id, args.keep_days)
    if removed_remote:
        log(f"清理云端旧备份 {removed_remote} 个（保留 {args.keep_days} 天）")
    log("完成")
    return 0


if __name__ == "__main__":
    sys.exit(main())
