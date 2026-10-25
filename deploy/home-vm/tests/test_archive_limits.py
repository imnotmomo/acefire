"""Bound compressed metadata before delegating archive parsing to tarfile."""
import gzip
import importlib.util
import io
from pathlib import Path
import tarfile
import unittest
from unittest.mock import patch


spec = importlib.util.spec_from_file_location(
    'archive_verifier', Path(__file__).resolve().parents[1] / 'verify_release.py',
)
verifier = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verifier)


def make_archive(name, content=b'x', format=tarfile.USTAR_FORMAT):
    stream = io.BytesIO()
    with tarfile.open(fileobj=stream, mode='w:gz', format=format) as archive:
        member = tarfile.TarInfo(name)
        member.size = len(content)
        archive.addfile(member, io.BytesIO(content))
    return stream.getvalue()


class ArchiveLimitTests(unittest.TestCase):
    def test_regular_ustar_files_remain_supported(self):
        payload = make_archive('app/module.py', b'fixture')
        self.assertEqual(verifier.archive_files(payload), {'app/module.py': b'fixture'})

    def test_pax_long_path_is_rejected_before_tar_parser_expansion(self):
        payload = make_archive('app/' + 'a' * 4096, format=tarfile.PAX_FORMAT)
        with patch.object(verifier.tarfile, 'open') as parser:
            with self.assertRaisesRegex(ValueError, 'USTAR'):
                verifier.archive_files(payload, limit=1)
        parser.assert_not_called()

    def test_compressed_stream_expansion_is_bounded_before_tar_parsing(self):
        # Repeated bytes keep the input small while exceeding the decompression cap.
        payload = gzip.compress(b'\0' * (32 * 1024 * 1024 + 2))
        self.assertLess(len(payload), 100_000)
        with patch.object(verifier.tarfile, 'open') as parser:
            with self.assertRaisesRegex(ValueError, 'Expanded tar stream'):
                verifier.archive_files(payload, limit=1)
        parser.assert_not_called()

    def test_control_characters_cannot_enter_materialized_paths(self):
        payload = make_archive('app/misleading\nfilename.py')
        with self.assertRaisesRegex(ValueError, 'unsafe'):
            verifier.archive_files(payload)


if __name__ == '__main__':
    unittest.main()
