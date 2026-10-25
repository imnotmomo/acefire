"""Validate bounded release archives without trusting archive paths or metadata."""
from hashlib import sha256
from pathlib import Path, PurePosixPath
import io
import gzip
import json
import re
import tarfile

MAX_ARCHIVE = 180 * 1024 * 1024
MAX_CONTENT = 300 * 1024 * 1024
MAX_FILES = 6000
SHA = re.compile(r"[a-f0-9]{40}\Z")


def archive_files(payload, limit=MAX_CONTENT):
    if len(payload) > MAX_ARCHIVE:
        raise ValueError("Archive exceeds size limit")
    # Meter decompression before a tar parser can allocate extended-header data.
    bound = limit + 32 * 1024 * 1024
    if payload.startswith(b'\x1f\x8b'):
        with gzip.GzipFile(fileobj=io.BytesIO(payload)) as compressed:
            raw = compressed.read(bound + 1)
    else:
        raw = payload
    if len(raw) > bound:
        raise ValueError('Expanded tar stream exceeds limit')
    offset, count = 0, 0
    while offset + 512 <= len(raw):
        header = raw[offset:offset + 512]
        if not any(header):
            if any(raw[offset:]):
                raise ValueError('Unexpected data after tar terminator')
            break
        if header[156:157] not in (b'0', b'\0'):
            raise ValueError('Only regular USTAR members are supported')
        size_field = header[124:136].strip(b'\0 ')
        if not size_field or any(char not in b'01234567' for char in size_field):
            raise ValueError('Invalid tar member size')
        size = int(size_field, 8)
        count += 1
        if size > limit or count > MAX_FILES:
            raise ValueError('Tar member exceeds limit')
        offset += 512 + ((size + 511) // 512) * 512
        if offset > len(raw):
            raise ValueError('Truncated tar stream')
    result, total = {}, 0
    with tarfile.open(fileobj=io.BytesIO(raw), mode="r:") as archive:
        for member in archive:
            path = PurePosixPath(member.name)
            if (not member.isfile() or path.is_absolute() or
                    any(part in ("", ".", "..") for part in member.name.split("/")) or
                    "\\" in member.name or member.name in result or
                    len(member.name.encode()) > 1024 or
                    any(ord(char) < 32 for char in member.name)):
                raise ValueError("Archive contains an unsafe or duplicate path")
            total += member.size
            if member.size < 0 or total > limit or len(result) >= MAX_FILES:
                raise ValueError("Archive content exceeds limit")
            content = archive.extractfile(member).read(member.size + 1)
            if len(content) != member.size:
                raise ValueError("Truncated archive member")
            result[member.name] = content
    return result


def verify_release(payload, manifest, expected_sha):
    if not SHA.fullmatch(expected_sha) or manifest.get("commit") != expected_sha:
        raise ValueError("Release commit mismatch")
    if manifest.get("schema_version") != 1:
        raise ValueError("Unsupported release manifest")
    if manifest.get("archive_sha256") != sha256(payload).hexdigest():
        raise ValueError("Release archive hash mismatch")
    files = archive_files(payload)
    entries = manifest.get("files", [])
    expected = {entry["path"]: entry for entry in entries}
    if len(expected) != len(entries) or set(expected) != set(files):
        raise ValueError("Release file inventory mismatch")
    for name, content in files.items():
        if not name.startswith(("app/", "public/")):
            raise ValueError("Release has an unsupported root")
        if any(part in (".git", ".venv", "node_modules", ".cache") for part in name.split("/")):
            raise ValueError("Release contains local runtime files")
        basename = PurePosixPath(name).name
        if (basename == ".env" or (basename.startswith(".env.") and basename != ".env.example") or
                basename.endswith((".duckdb", ".pem", ".key"))):
            raise ValueError("Release contains a private runtime file")
        entry = expected[name]
        if entry["bytes"] != len(content) or entry["sha256"] != sha256(content).hexdigest():
            raise ValueError("Release member hash mismatch")
    for required in ("app/backend/requirements.lock", "app/backend/app/main.py", "public/index.html", "public/release.json"):
        if required not in files:
            raise ValueError("Required application file missing")
    metadata = json.loads(files["public/release.json"])
    if metadata.get("commit") != expected_sha:
        raise ValueError("Public release commit mismatch")
    return files


def write_files(files, destination):
    """Caller supplies validated regular files and a new, private directory."""
    destination = Path(destination)
    for name, content in files.items():
        path = destination / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
        path.chmod(0o640)
