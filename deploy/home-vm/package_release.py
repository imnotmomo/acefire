#!/usr/bin/env python3
"""Package the tested checkout and built frontend; credentials never enter it."""
import argparse
from hashlib import sha256
import io
import json
from pathlib import Path
import subprocess
import tarfile

from verify_release import SHA, verify_release


def package(repo, commit, output):
    if not SHA.fullmatch(commit):
        raise ValueError("An exact commit SHA is required")
    head = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=repo, text=True).strip()
    if head != commit:
        raise ValueError("Checkout does not match requested release")
    files = {}
    # Read committed Git objects rather than unrelated dirty working-tree files.
    source = subprocess.check_output(["git", "archive", "--format=tar", commit], cwd=repo)
    with tarfile.open(fileobj=io.BytesIO(source)) as archive:
        for member in archive:
            if member.isdir():
                continue
            relative = member.name
            if relative.startswith(("data/", "docs/archive/", ".agents/")):
                continue
            if not member.isfile():
                raise ValueError("Source symlinks and special files are not supported")
            files["app/" + relative] = archive.extractfile(member).read()
    dist = repo / "frontend/dist"
    if not (dist / "index.html").is_file():
        raise ValueError("Build the frontend before packaging")
    for path in sorted(dist.rglob("*")):
        if path.is_symlink():
            raise ValueError("Distribution symlinks are not supported")
        if path.is_file():
            files["public/" + str(path.relative_to(dist))] = path.read_bytes()
    files["public/release.json"] = (json.dumps({
        "schema_version": 1, "commit": commit, "backend_commit": commit,
        "deployment_target": "acefire-home-vm", "frontend": "Ingenium",
        "storage": "firestore", "firebase_project_id": "acefire-50248",
        "database_id": "acefire", "firebase_database_edition": "STANDARD",
    }, indent=2) + "\n").encode()
    stream = io.BytesIO()
    with tarfile.open(fileobj=stream, mode="w:gz", format=tarfile.USTAR_FORMAT) as archive:
        for name, content in sorted(files.items()):
            entry = tarfile.TarInfo(name)
            entry.size, entry.mode = len(content), 0o644
            archive.addfile(entry, io.BytesIO(content))
    payload = stream.getvalue()
    manifest = {"schema_version": 1, "commit": commit, "archive_sha256": sha256(payload).hexdigest(),
                "files": [{"path": name, "bytes": len(content), "sha256": sha256(content).hexdigest()}
                          for name, content in sorted(files.items())]}
    verify_release(payload, manifest, commit)
    output.mkdir(parents=True, exist_ok=True)
    (output / "release.tar.gz").write_bytes(payload)
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"Packaged {commit}: {len(files)} verified files")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--commit", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    package(Path(__file__).resolve().parents[2], args.commit, args.output)
