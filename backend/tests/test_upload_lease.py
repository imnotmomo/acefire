"""Real host leases plus a simulated Windows stdlib import/locking branch."""
import builtins
import errno
from pathlib import Path
from types import ModuleType, SimpleNamespace

import pytest

from app.upload_lease import try_lock, unlock


def test_host_lease_contention_and_release_without_a_pid_probe(tmp_path):
    path = tmp_path/'worker.lock'
    with path.open('a+b') as owner, path.open('a+b') as contender:
        assert try_lock(owner) is True
        assert try_lock(contender) is False
        unlock(owner)
        assert try_lock(contender) is True
        contender.close()  # Closing the owner must release the OS lease.
        assert try_lock(owner) is True


def windows_module(monkeypatch, locking):
    source_path = Path(__file__).resolve().parents[1]/'app'/'upload_lease.py'
    source = source_path.read_text()
    original_import = builtins.__import__
    windows = SimpleNamespace(locking=locking, LK_NBLCK=2, LK_UNLCK=0)
    def imports(name, *args, **kwargs):
        if name == 'fcntl':
            raise ImportError('fcntl is unavailable on Windows')
        if name == 'msvcrt':
            return windows
        return original_import(name, *args, **kwargs)
    module = ModuleType('simulated_windows_upload_lease')
    with monkeypatch.context() as context:
        context.setattr(builtins, '__import__', imports)
        exec(compile(source, str(source_path), 'exec'), module.__dict__)
    assert module._fcntl is None
    return module


def test_windows_import_uses_nonblocking_byte_zero_lock_and_unlock(tmp_path, monkeypatch):
    calls, held = [], []
    def locking(descriptor, mode, length):
        calls.append((descriptor, mode, length))
        if mode == 2:
            if held:raise OSError(errno.EACCES, 'Another process holds this byte')
            held.append(descriptor)
        else:
            held.clear()
    module = windows_module(monkeypatch, locking)
    path = tmp_path/'windows.lock'
    with path.open('a+b') as owner, path.open('a+b') as contender:
        assert module.try_lock(owner) is True
        assert path.read_bytes() == b'\0'
        assert owner.tell() == 0
        assert module.try_lock(contender) is False
        assert contender.tell() == 0
        owner.seek(1)
        module.unlock(owner)
        assert owner.tell() == 0
        assert module.try_lock(contender) is True
        module.unlock(contender)
        assert all(length == 1 for _, _, length in calls)
        assert [mode for _, mode, _ in calls] == [2, 2, 0, 2, 0]


def test_windows_locking_surfaces_real_io_errors_instead_of_claiming_an_active_worker(tmp_path, monkeypatch):
    def broken(*args):raise OSError(errno.EBADF, 'Invalid file descriptor')
    module = windows_module(monkeypatch, broken)
    with (tmp_path/'broken.lock').open('a+b') as stream:
        with pytest.raises(OSError) as error:
            module.try_lock(stream)
    assert error.value.errno == errno.EBADF


def test_windows_legacy_receipts_never_use_os_kill_as_a_liveness_probe(monkeypatch):
    from app import workspace_routes
    def forbidden(*args):raise AssertionError('Windows must never probe a process with os.kill(pid, 0).')
    monkeypatch.setattr(workspace_routes, 'os', SimpleNamespace(name='nt', getpid=lambda:100, kill=forbidden))
    # Legacy receipts have no retained OS lease. They are recoverable failures,
    # rather than guessing that an unrelated process is still extracting them.
    assert workspace_routes.UploadJobs.active(SimpleNamespace(), {'owner_pid':200,'status':'processing'}) is False
