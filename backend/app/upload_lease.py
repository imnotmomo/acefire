"""Process-owned, nonblocking upload leases using the host's standard library."""
import errno
import os

try:
    import fcntl as _fcntl
except ImportError:  # Windows has no fcntl module.
    _fcntl = None
    import msvcrt as _msvcrt
else:
    _msvcrt = None


def try_lock(stream):
    """Acquire this open binary file's lease, or return False on contention.

    Closing the stream also releases the lock, including when its process dies.
    Windows byte locks always cover byte zero of the same retained lease file.
    """
    if _fcntl is not None:
        try:
            _fcntl.flock(stream.fileno(), _fcntl.LOCK_EX | _fcntl.LOCK_NB)
        except BlockingIOError:
            return False
    else:
        stream.seek(0, os.SEEK_END)
        if stream.tell() == 0:
            stream.write(b'\0')
            stream.flush()
        stream.seek(0)
        try:
            _msvcrt.locking(stream.fileno(), _msvcrt.LK_NBLCK, 1)
        except OSError as error:
            if error.errno in (errno.EACCES, errno.EAGAIN, errno.EDEADLK):
                return False
            raise
    return True


def unlock(stream):
    if _fcntl is not None:
        _fcntl.flock(stream.fileno(), _fcntl.LOCK_UN)
    else:
        stream.seek(0)
        _msvcrt.locking(stream.fileno(), _msvcrt.LK_UNLCK, 1)
