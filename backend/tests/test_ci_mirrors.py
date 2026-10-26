import importlib.util
from pathlib import Path

script = Path(__file__).resolve().parents[2] / 'scripts/ci/ubuntu_mirrors.py'
spec = importlib.util.spec_from_file_location('ubuntu_mirrors', script)
mirrors = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mirrors)


def test_effective_ubuntu_mirror_files_are_rewritten_without_changing_signing(tmp_path):
    apt = tmp_path/'etc/apt'
    fixtures = {
        'sources.list': 'deb http://azure.archive.ubuntu.com/ubuntu/ noble main universe\n',
        'apt-mirrors.txt': 'http://azure.archive.ubuntu.com/ubuntu/\nhttp://archive.ubuntu.com/ubuntu/\n',
        'mirrors/ubuntu.list': 'http://azure.archive.ubuntu.com/ubuntu\n',
        'mirrors/ubuntu-security.list': 'http://security.ubuntu.com/ubuntu/\n',
        'sources.list.d/ubuntu.sources': 'Types: deb\nURIs: mirror+file:/etc/apt/apt-mirrors.txt\nSuites: noble noble-updates noble-security\nComponents: main universe\nSigned-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\n',
    }
    for name, value in fixtures.items():
        path = apt/name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(value)
    changed = mirrors.configure(tmp_path)
    assert {path.relative_to(apt).as_posix() for path in changed} == set(fixtures) - {'sources.list.d/ubuntu.sources'}
    for name in fixtures:
        content = (apt/name).read_text()
        assert 'http://azure.archive.ubuntu.com' not in content
        assert 'http://archive.ubuntu.com' not in content
        assert 'http://security.ubuntu.com' not in content
    assert (apt/'sources.list.d/ubuntu.sources').read_text() == fixtures['sources.list.d/ubuntu.sources']
    assert mirrors.configure(tmp_path) == []


def test_only_official_ubuntu_hosts_are_changed_and_direct_sources_are_supported():
    original = 'URIs: https://azure.archive.ubuntu.com/ubuntu/\nSigned-By: /keyring.gpg\nSuites: noble\nComponents: main restricted\nOther: https://packages.example.test/ubuntu\nNotUbuntu: http://azure.archive.ubuntu.com/ubuntu-ports\n'
    updated = mirrors.rewrite(original)
    assert updated == original.replace('https://azure.archive.ubuntu.com/ubuntu/\n', 'https://archive.ubuntu.com/ubuntu/\n')
