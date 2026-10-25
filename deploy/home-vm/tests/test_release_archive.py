"""Trust-boundary checks: corrupted archives must fail before deployment."""
from hashlib import sha256
import importlib.util
import io
import json
from pathlib import Path
import tarfile
import unittest

spec = importlib.util.spec_from_file_location('verify_release', Path(__file__).parents[1] / 'verify_release.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
COMMIT = 'a' * 40


def archive(entries):
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode='w') as tar:
        for name, value in entries.items():
            member = tarfile.TarInfo(name)
            if value is None:
                member.type, member.linkname = tarfile.SYMTYPE, '/etc/passwd'
                tar.addfile(member)
            else:
                member.size = len(value)
                tar.addfile(member, io.BytesIO(value))
    return buffer.getvalue()


class ArchiveBoundaryTests(unittest.TestCase):
    def test_rejects_traversal_absolute_links_and_duplicate_names(self):
        for name in ['../etc/passwd', '/etc/passwd', 'app/../private', 'app//bad', 'app/./bad', 'app\\bad']:
            with self.subTest(name=name), self.assertRaises(ValueError):
                module.archive_files(archive({name: b'x'}))
        with self.assertRaises(ValueError):
            module.archive_files(archive({'app/link': None}))

    def test_rejects_expanded_payload_before_reading_it(self):
        with self.assertRaises(ValueError):
            module.archive_files(archive({'app/huge': b'12345'}), limit=4)

    def test_detects_corruption_wrong_commit_and_private_files(self):
        files = {'app/backend/requirements.lock': b'x', 'app/backend/app/main.py': b'x',
                 'public/index.html': b'<html>', 'public/release.json': json.dumps({'commit': COMMIT}).encode()}
        def manifest(payload):
            return {'schema_version': 1, 'commit': COMMIT, 'archive_sha256': sha256(payload).hexdigest(),
                    'files': [{'path': name, 'bytes': len(value), 'sha256': sha256(value).hexdigest()} for name, value in files.items()]}
        payload = archive(files)
        self.assertEqual(module.verify_release(payload, manifest(payload), COMMIT), files)
        for bad_payload, bad_commit in [(payload + b'x', COMMIT), (payload, 'b' * 40)]:
            with self.assertRaises(ValueError):
                module.verify_release(bad_payload, manifest(payload), bad_commit)
        files['app/backend/.env'] = b'SECRET=private'
        payload = archive(files)
        with self.assertRaises(ValueError):
            module.verify_release(payload, manifest(payload), COMMIT)


if __name__ == '__main__':
    unittest.main()
