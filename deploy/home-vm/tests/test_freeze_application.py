"""Ensure root ownership changes cannot follow unprivileged build symlinks."""
from contextlib import ExitStack
import importlib.util
import os
from pathlib import Path
import stat
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch


spec = importlib.util.spec_from_file_location(
    'freeze_controller', Path(__file__).resolve().parents[1] / 'apply_release.py',
)
controller = importlib.util.module_from_spec(spec)
spec.loader.exec_module(controller)


class FreezeApplicationTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        self.app = self.root / 'app'
        self.app.mkdir()
        self.outside = self.root / 'outside'
        self.outside.write_bytes(b'Unrelated host file')
        self.outside.chmod(0o604)

    def privilege_mocks(self):
        stack = ExitStack()
        stack.enter_context(patch.object(controller.os, 'fchown'))
        stack.enter_context(patch.object(
            controller.pwd, 'getpwnam', return_value=SimpleNamespace(pw_gid=os.getgid()),
        ))
        return stack

    def assert_outside_untouched(self):
        self.assertEqual(self.outside.read_bytes(), b'Unrelated host file')
        self.assertEqual(stat.S_IMODE(self.outside.stat().st_mode), 0o604)

    def test_regular_files_are_frozen_and_existing_external_symlinks_are_ignored(self):
        package = self.app / 'package'
        package.mkdir()
        ordinary = package / 'module.py'
        ordinary.write_bytes(b'# application module\n')
        ordinary.chmod(0o600)
        executable = package / 'worker'
        executable.write_bytes(b'#!/usr/bin/env python3\n')
        executable.chmod(0o700)
        (package / 'outside-link').symlink_to(self.outside)
        with self.privilege_mocks():
            controller.freeze_application(self.app)
        self.assertEqual(stat.S_IMODE(ordinary.stat().st_mode), 0o640)
        self.assertEqual(stat.S_IMODE(executable.stat().st_mode), 0o750)
        self.assertEqual(stat.S_IMODE(package.stat().st_mode), 0o750)
        self.assertEqual(stat.S_IMODE(self.app.stat().st_mode), 0o750)
        self.assert_outside_untouched()

    def test_a_regular_file_replaced_by_symlink_before_open_is_rejected(self):
        victim = self.app / 'victim'
        victim.write_bytes(b'Build output')
        real_open = os.open
        replacements = []

        def replace_before_open(path, flags, *args, **kwargs):
            if path == 'victim' and kwargs.get('dir_fd') is not None:
                victim.unlink()
                victim.symlink_to(self.outside)
                replacements.append(True)
            return real_open(path, flags, *args, **kwargs)

        with self.privilege_mocks(), patch.object(controller.os, 'open', side_effect=replace_before_open):
            with self.assertRaises(OSError):
                controller.freeze_application(self.app)
        self.assertEqual(replacements, [True])
        self.assert_outside_untouched()

    def test_hardlinks_cannot_change_permissions_on_an_outside_inode(self):
        os.link(self.outside, self.app / 'linked-output')
        with self.privilege_mocks(), self.assertRaisesRegex(ValueError, 'hardlink'):
            controller.freeze_application(self.app)
        self.assert_outside_untouched()


if __name__ == '__main__':
    unittest.main()
