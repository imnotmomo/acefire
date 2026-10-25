#!/usr/bin/python3 -I
"""Restricted SSH entry point for the Ingenium deployment identity.

Install this file as a root-owned forced command. No requested shell command is
ever evaluated. Deployment archive bytes pass directly to the root controller.
"""
from __future__ import annotations

import json
import os
import re
import sys
from urllib.request import urlopen


DEPLOY_COMMAND = re.compile(r"deploy ([0-9a-f]{40})", re.ASCII)
CONTROLLER = "/usr/local/sbin/ingenium-apply-release"
MAX_STATUS_BYTES = 65_536
STATUS_FIELDS = {
    "health": ("status", "schema_version", "storage", "project_id", "database_id"),
    "release": (
        "release_id", "commit", "backend_commit", "backend_release_id",
        "deployment_target", "frontend", "storage", "transport", "public_hostname",
    ),
}


def parse_command(command: str) -> tuple[str, str | None]:
    if command == "status":
        return "status", None
    match = DEPLOY_COMMAND.fullmatch(command)
    if match:
        return "deploy", match.group(1)
    raise ValueError("Only 'status' and 'deploy <commit-sha>' are permitted.")


def read_status() -> dict:
    status = {}
    for key, path in (("health", "/api/health"), ("release", "/release.json")):
        with urlopen("http://127.0.0.1:8080" + path, timeout=5) as response:
            raw = response.read(MAX_STATUS_BYTES + 1)
        if len(raw) > MAX_STATUS_BYTES:
            raise ValueError("Status response exceeded its size limit.")
        value = json.loads(raw)
        if not isinstance(value, dict):
            raise ValueError("Invalid status response.")
        status[key] = {field: value[field] for field in STATUS_FIELDS[key] if field in value}
    return status


def main() -> int:
    if len(sys.argv) != 1:
        print("Arguments are not accepted by the SSH gateway.", file=sys.stderr)
        return 64
    try:
        operation, commit = parse_command(os.environ.get("SSH_ORIGINAL_COMMAND", ""))
    except ValueError as error:
        print(str(error), file=sys.stderr)
        return 64
    if operation == "status":
        try:
            print(json.dumps(read_status(), sort_keys=True))
            return 0
        except (OSError, ValueError):
            print("Deployment status is unavailable.", file=sys.stderr)
            return 1
    try:
        os.execve(
            "/usr/bin/sudo",
            ["/usr/bin/sudo", "-n", "--", CONTROLLER, commit],
            {
                "PATH": "/usr/sbin:/usr/bin:/sbin:/bin",
                "LANG": "C.UTF-8",
                "HOME": "/var/lib/ingenium-deploy",
            },
        )
    except OSError:
        print("The deployment controller could not be started.", file=sys.stderr)
        return 126
    return 126  # execve returns only when replaced by a test double.


if __name__ == "__main__":
    raise SystemExit(main())
