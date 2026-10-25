"""Security-boundary checks for the installed SSH forced-command gateway."""
from contextlib import redirect_stderr, redirect_stdout
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch


spec = importlib.util.spec_from_file_location(
    "ssh_entrypoint", Path(__file__).resolve().parents[1] / "ssh-entrypoint.py",
)
gateway = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gateway)
COMMIT = "ab" * 20


class SSHEntryPointTests(unittest.TestCase):
    def test_only_exact_protocol_commands_are_accepted(self):
        self.assertEqual(gateway.parse_command("status"), ("status", None))
        self.assertEqual(gateway.parse_command("deploy " + COMMIT), ("deploy", COMMIT))
        rejected = (
            "", "sh", "bash", "id", "scp -t /tmp", "internal-sftp", "sftp",
            " status", "status ", "status\n", "deploy\t" + COMMIT,
            "deploy " + COMMIT + "\n", "deploy " + COMMIT + ";id",
            "deploy " + COMMIT.upper(), "deploy " + "a" * 39,
            "deploy " + "a" * 41, "deploy ../etc/passwd", "deploy $(id)",
        )
        for command in rejected:
            with self.subTest(command=command), self.assertRaises(ValueError):
                gateway.parse_command(command)

    def test_rejected_command_cannot_start_privileged_controller(self):
        with patch.object(sys, "argv", ["gateway"]), patch.dict(
            os.environ, {"SSH_ORIGINAL_COMMAND": "deploy " + COMMIT + "; id"}, clear=True,
        ), patch.object(gateway.os, "execve") as execute, redirect_stderr(io.StringIO()):
            self.assertEqual(gateway.main(), 64)
            execute.assert_not_called()

    def test_deploy_uses_fixed_argv_and_drops_inherited_environment(self):
        with patch.object(sys, "argv", ["gateway"]), patch.dict(
            os.environ,
            {"SSH_ORIGINAL_COMMAND": "deploy " + COMMIT, "LD_PRELOAD": "/tmp/inject", "PATH": "/tmp"},
            clear=True,
        ), patch.object(gateway.os, "execve") as execute:
            gateway.main()
        execute.assert_called_once_with(
            "/usr/bin/sudo", ["/usr/bin/sudo", "-n", "--", gateway.CONTROLLER, COMMIT],
            {"PATH": "/usr/sbin:/usr/bin:/sbin:/bin", "LANG": "C.UTF-8", "HOME": "/var/lib/ingenium-deploy"},
        )

    def test_status_uses_no_sudo_and_reports_only_public_fields(self):
        health = {"status": "ok", "database_id": "acefire", "unexpected": "omit"}
        release = {"release_id": "home-123", "commit": COMMIT, "unexpected": "omit"}
        responses = [io.BytesIO(json.dumps(value).encode()) for value in (health, release)]
        output = io.StringIO()
        with patch.object(sys, "argv", ["gateway"]), patch.dict(
            os.environ, {"SSH_ORIGINAL_COMMAND": "status"}, clear=True,
        ), patch.object(gateway, "urlopen", side_effect=responses) as fetch, patch.object(
            gateway.os, "execve",
        ) as execute, redirect_stdout(output):
            self.assertEqual(gateway.main(), 0)
        self.assertEqual(json.loads(output.getvalue()), {
            "health": {"status": "ok", "database_id": "acefire"},
            "release": {"release_id": "home-123", "commit": COMMIT},
        })
        self.assertEqual([call.args[0] for call in fetch.call_args_list], [
            "http://127.0.0.1:8080/api/health", "http://127.0.0.1:8080/release.json",
        ])
        execute.assert_not_called()

    def test_status_rejects_oversized_response_without_printing_it(self):
        output = io.StringIO()
        with patch.object(sys, "argv", ["gateway"]), patch.dict(
            os.environ, {"SSH_ORIGINAL_COMMAND": "status"}, clear=True,
        ), patch.object(gateway, "urlopen", return_value=io.BytesIO(b"x" * (gateway.MAX_STATUS_BYTES + 1))), \
                redirect_stdout(output), redirect_stderr(io.StringIO()):
            self.assertEqual(gateway.main(), 1)
        self.assertEqual(output.getvalue(), "")

    def test_direct_script_arguments_are_denied(self):
        with patch.object(sys, "argv", ["gateway", "status"]), patch.object(
            gateway.os, "execve",
        ) as execute, redirect_stderr(io.StringIO()):
            self.assertEqual(gateway.main(), 64)
        execute.assert_not_called()


if __name__ == "__main__":
    unittest.main()
