#!/usr/bin/python3 -I
"""Root-owned release controller, invoked only by the restricted SSH gateway."""
from pathlib import Path
import fcntl
from hashlib import sha256
import json
import os
import pwd
import re
import shutil
import signal
import stat
import subprocess
import sys
import tempfile
import time
import traceback
import urllib.error
import urllib.request

sys.path.insert(0, str(Path(__file__).resolve().parent))
from verify_release import SHA, archive_files, verify_release, write_files

STATE = Path('/var/lib/ingenium-cd')
APP = Path('/srv/ingenium')
PUBLIC = Path('/var/www/ingenium')
ETC = Path('/etc/ingenium')
RUNTIME_FILES = ('backend.env', 'firestore-runtime.json', 'prism.env')
REQUIRED_ENV = {
    'DATA_STORE': 'firestore', 'FIREBASE_PROJECT_ID': 'acefire-50248',
    'FIRESTORE_DATABASE_ID': 'acefire',
    'GOOGLE_APPLICATION_CREDENTIALS': '/etc/ingenium/firestore-runtime.json',
    'SOURCE_FILE_MANIFEST': '/etc/ingenium/source-files.json',
}


def command(args, log, **kwargs):
    subprocess.run(args, check=True, stdout=log, stderr=log, **kwargs)


def atomic_file(path, content, mode=0o600, group=None):
    temporary = path.with_name(path.name + '.new')
    temporary.write_bytes(content)
    temporary.chmod(mode)
    os.chown(temporary, 0, pwd.getpwnam('ingenium').pw_gid if group else 0)
    os.replace(temporary, path)


def atomic_link(path, target):
    temporary = path.with_name(path.name + '.new')
    temporary.unlink(missing_ok=True)
    temporary.symlink_to(target)
    os.replace(temporary, path)


def get(path, deadline=None):
    remaining = 8 if deadline is None else min(8, deadline - time.monotonic())
    if remaining <= 0:
        raise TimeoutError('Readiness deadline exceeded')
    with urllib.request.urlopen(path, timeout=remaining) as response:
        return response.read()


def ready(commit=None, release_id=None, files=None, public=False):
    base = 'https://acefire.linearproduct.co' if public else 'http://127.0.0.1:8080'
    deadline = time.monotonic() + (120 if public else 60)
    for attempt in range(30):
        try:
            health = json.loads(get(base + '/api/health', deadline))
            assert health['status'] == 'ok' and health['storage'] == 'firestore'
            assert health['project_id'] == 'acefire-50248' and health['database_id'] == 'acefire'
            if commit:
                metadata = json.loads(get(base + '/release.json', deadline))
                assert metadata['commit'] == commit and metadata['release_id'] == release_id
                assert sha256(get(base + '/index.html', deadline)).digest() == sha256(files['public/index.html']).digest()
                if public:
                    for name, content in files.items():
                        if name.startswith('public/assets/') and name.endswith(('.js', '.css')):
                            assert sha256(get(base + '/' + name.removeprefix('public/'), deadline)).digest() == sha256(content).digest()
            return
        except (OSError, ValueError, KeyError, AssertionError):
            if attempt == 29 or time.monotonic() >= deadline:
                raise RuntimeError('Release readiness check failed') from None
            time.sleep(1)


def validate_runtime(bundle):
    values = {}
    for line in bundle['backend.env'].decode().splitlines():
        if not line or line.startswith('#'):
            continue
        key, sep, value = line.partition('=')
        if not sep or not re.fullmatch(r'[A-Z][A-Z0-9_]*', key) or key in values:
            raise ValueError('Invalid backend environment')
        values[key] = json.loads(value) if value.startswith('"') else value
        if not isinstance(values[key], str) or any(c in values[key] for c in '\x00\r\n'):
            raise ValueError('Invalid environment value')
    allowed = set(REQUIRED_ENV) | {'NICRRON_API_KEY', 'NICRRON_BASE_URL', 'LLM_MODEL', 'AKTA_API_KEY'}
    if set(values) - allowed or any(values.get(k) != v for k, v in REQUIRED_ENV.items()):
        raise ValueError('Runtime targets a different store or private path')
    if not values.get('NICRRON_API_KEY') or values.get('NICRRON_BASE_URL') != 'https://api.nicrron.ai/v1':
        raise ValueError('Missing configured model credential')
    credential = json.loads(bundle['firestore-runtime.json'])
    if (credential.get('type') != 'service_account' or credential.get('project_id') != 'acefire-50248' or
            credential.get('client_email') != 'ingenium-home@acefire-50248.iam.gserviceaccount.com'):
        raise ValueError('Unexpected Firestore runtime identity')
    if len(bundle['prism.env']) > 20000 or b'PRISMTRACE_API_KEY=' not in bundle['prism.env']:
        raise ValueError('Missing PRISM runtime configuration')


class BranchHeadError(RuntimeError):
    """A deliberately sanitized error that is safe for Actions logs."""


class NoApiRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        # Never forward the job credential to a redirected destination.
        return None


def validate_github_token(value):
    if isinstance(value, bytes):
        try:
            value = value.decode('ascii')
        except UnicodeDecodeError:
            value = None
    if not isinstance(value, str) or not re.fullmatch(r'[A-Za-z0-9_.-]{20,8192}', value):
        raise BranchHeadError('A current workflow GitHub token is required; start a new workflow run.')
    return value


def require_branch_head(commit, github_token):
    token = validate_github_token(github_token)
    request = urllib.request.Request(
        'https://api.github.com/repos/imnotmomo/acefire/git/ref/heads/main',
        headers={'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json',
                 'X-GitHub-Api-Version': '2026-03-10', 'User-Agent': 'Ingenium-Deployment'},
    )
    opener = urllib.request.build_opener(NoApiRedirect())
    try:
        with opener.open(request, timeout=20) as response:
            current = json.load(response)['object']['sha']
            if not isinstance(current, str) or not SHA.fullmatch(current):
                raise ValueError('Invalid GitHub reference response')
    except urllib.error.HTTPError as error:
        error.close()
        message = f'GitHub branch verification failed (HTTP {error.code})'
        if error.code in (403, 429) and error.headers.get('X-RateLimit-Remaining') == '0':
            message += ': the authenticated workflow API quota is exhausted'
            reset = error.headers.get('X-RateLimit-Reset', '')
            if reset.isdecimal():
                message += f' (reset epoch {reset})'
        elif error.code == 401:
            message += ': the job token was rejected; start a new workflow run'
        elif error.code == 403:
            message += ': check the job token contents:read permission'
        elif 300 <= error.code < 400:
            message += ': redirects are not permitted for credentialed requests'
        raise BranchHeadError(message + '. Live activation was not attempted.') from None
    except (OSError, ValueError, KeyError, TypeError):
        raise BranchHeadError('GitHub branch verification could not complete. Live activation was not attempted.') from None
    if current != commit:
        raise BranchHeadError('A newer main commit superseded this release; live activation was not attempted.')


def freeze_application(app):
    group = pwd.getpwnam('ingenium').pw_gid
    root = os.open(app, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for _, _, names, directory in os.fwalk('.', topdown=False, follow_symlinks=False, dir_fd=root):
            for name in names:
                info = os.stat(name, dir_fd=directory, follow_symlinks=False)
                if stat.S_ISLNK(info.st_mode):
                    continue
                handle = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory)
                try:
                    info = os.fstat(handle)
                    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
                        raise ValueError('Unexpected build file type or hardlink')
                    os.fchown(handle, 0, group)
                    os.fchmod(handle, 0o750 if info.st_mode & 0o111 else 0o640)
                finally:
                    os.close(handle)
            os.fchown(directory, 0, group)
            os.fchmod(directory, 0o750)
    finally:
        os.close(root)


def prune_releases(protected):
    candidates = sorted((path for path in (APP / 'releases').glob('ci-*')
                         if re.fullmatch(r'ci-[0-9]+-[0-9]+-[a-f0-9]{12}', path.name) and not path.is_symlink()),
                        key=lambda path: path.stat().st_mtime, reverse=True)
    keep = set(candidates[:3]) | set(protected)
    for path in candidates:
        if path not in keep:
            shutil.rmtree(path)
            public = PUBLIC / 'releases' / path.name
            if public.is_dir() and not public.is_symlink():
                shutil.rmtree(public)


def deploy(commit):
    os.umask(0o077)
    if os.geteuid() != 0 or not SHA.fullmatch(commit):
        raise ValueError('Exact SHA and root controller are required')
    STATE.mkdir(mode=0o700, parents=True, exist_ok=True)
    with open('/run/ingenium-home-deploy.lock', 'w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        raw = sys.stdin.buffer.read(180 * 1024 * 1024 + 1)
        bundle = archive_files(raw, limit=180 * 1024 * 1024)
        required = {'release.tar.gz', 'manifest.json', 'deployment.json', *RUNTIME_FILES}
        if not required <= set(bundle) or set(bundle) - required - {'github-api-token'}:
            raise ValueError('Unexpected deployment bundle files')
        # This short-lived read-only token stays in process memory. It never
        # enters application files, runtime snapshots, state or audit metadata.
        github_token = validate_github_token(bundle.pop('github-api-token', b''))
        if any(len(bundle[name]) > 100000 for name in (*RUNTIME_FILES, 'deployment.json')):
            raise ValueError('Runtime configuration exceeds limit')
        if len(bundle['manifest.json']) > 3 * 1024 * 1024:
            raise ValueError('Release manifest exceeds limit')
        deployment = json.loads(bundle['deployment.json'])
        if set(deployment) != {'commit', 'run_number', 'run_id', 'run_attempt'}:
            raise ValueError('Unexpected workflow metadata fields')
        for key in ('run_number', 'run_id', 'run_attempt'):
            if type(deployment.get(key)) is not int or deployment[key] < 1:
                raise ValueError('Invalid workflow identity')
        if deployment.get('commit') != commit:
            raise ValueError('Workflow commit mismatch')
        previous_state = json.loads((STATE / 'state.json').read_text()) if (STATE / 'state.json').exists() else {}
        if deployment['run_number'] < previous_state.get('run_number', 0):
            raise ValueError('Refusing a deployment older than the active workflow')
        # The source of a deployment must still be the trusted branch head.
        require_branch_head(commit, github_token)
        files = verify_release(bundle['release.tar.gz'], json.loads(bundle['manifest.json']), commit)
        validate_runtime(bundle)
        if previous_state.get('commit') == commit and deployment['run_number'] == previous_state.get('run_number'):
            ready()
            print(json.dumps({'status': 'already_deployed', **previous_state}))
            return
        release_id = f"ci-{deployment['run_id']}-{deployment['run_attempt']}-{commit[:12]}"
        app, public = APP / 'releases' / release_id, PUBLIC / 'releases' / release_id
        if app.exists() or public.exists():
            raise ValueError('Release directory already exists; rerun with a new workflow attempt')
        backup = STATE / release_id
        backup.mkdir(mode=0o700)
        (backup / 'manifest.json').write_bytes(bundle['manifest.json'])
        (backup / 'deployment.json').write_bytes(bundle['deployment.json'])
        old_app, old_public = (APP / 'current').resolve(), (PUBLIC / 'current').resolve()
        old_runtime = {name: (ETC / name).read_bytes() for name in RUNTIME_FILES}
        for name, content in old_runtime.items():
            (backup / name).write_bytes(content)
        (backup / 'previous-links.json').write_text(json.dumps({'app': str(old_app), 'public': str(old_public)}))
        metadata = json.loads(files['public/release.json'])
        metadata.update(release_id=release_id, backend_release_id=release_id, workflow_run_id=deployment['run_id'])
        files['public/release.json'] = (json.dumps(metadata, indent=2) + '\n').encode()
        switched, succeeded = False, False
        with (backup / 'deployment.log').open('ab') as log:
            try:
                with tempfile.TemporaryDirectory(dir=STATE) as scratch:
                    scratch = Path(scratch)
                    write_files(files, scratch)
                    shutil.move(str(scratch / 'app'), app)
                    shutil.move(str(scratch / 'public'), public)
                command(['/usr/bin/chown', '-R', 'ingenium:ingenium', str(app)], log)
                for directory in [public, *[p for p in public.rglob('*') if p.is_dir()]]:
                    directory.chmod(0o755)
                for path in public.rglob('*'):
                    if path.is_file():
                        path.chmod(0o644)
                command(['/usr/sbin/runuser', '-u', 'ingenium', '--', '/usr/bin/python3', '-m', 'venv', str(app / 'backend/.venv')], log)
                python = str(app / 'backend/.venv/bin/python')
                command(['/usr/sbin/runuser', '-u', 'ingenium', '--', python, '-m', 'pip', 'install', '--disable-pip-version-check', '-r', str(app / 'backend/requirements.lock')], log, timeout=600)
                command(['/usr/sbin/runuser', '-u', 'ingenium', '--', python, '-m', 'pip', 'check'], log)
                freeze_application(app)
                # No artifact-supplied scripts, units or Nginx configs run as root.
                # Current systemd hardening, PRISM bootstrap and private file caches stay in place.
                require_branch_head(commit, github_token)
                switched = True
                command(['/usr/bin/systemctl', 'stop', 'ingenium-backend'], log)
                for name in RUNTIME_FILES:
                    atomic_file(ETC / name, bundle[name], 0o600 if name == 'backend.env' else 0o640, name != 'backend.env')
                atomic_link(APP / 'current', app)
                atomic_link(PUBLIC / 'current', public)
                command(['/usr/bin/systemctl', 'start', 'ingenium-backend'], log)
                ready(commit, release_id, files)
                ready(commit, release_id, files, public=True)
                state = {**deployment, 'release_id': release_id, 'previous_app': str(old_app), 'previous_public': str(old_public)}
                atomic_file(STATE / 'state.json', json.dumps(state).encode())
                succeeded = True
            except BaseException as error:
                log.write(traceback.format_exc().encode())
                if switched and not succeeded:
                    command(['/usr/bin/systemctl', 'stop', 'ingenium-backend'], log)
                    for name, content in old_runtime.items():
                        atomic_file(ETC / name, content, 0o600 if name == 'backend.env' else 0o640, name != 'backend.env')
                    atomic_link(APP / 'current', old_app)
                    atomic_link(PUBLIC / 'current', old_public)
                    command(['/usr/bin/systemctl', 'start', 'ingenium-backend'], log)
                    ready()
                if app != (APP / 'current').resolve() and public != (PUBLIC / 'current').resolve():
                    shutil.rmtree(app, ignore_errors=True)
                    shutil.rmtree(public, ignore_errors=True)
                if isinstance(error, BranchHeadError):
                    raise BranchHeadError(f'{error} Private audit: {backup}') from None
                raise RuntimeError(f'Deployment failed; private audit: {backup}') from None
        prune_releases({app, old_app})
        print(json.dumps({'status': 'deployed', 'commit': commit, 'release_id': release_id}))


if __name__ == '__main__':
    def interrupted(signum, frame):
        raise RuntimeError('Deployment interrupted')
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGHUP, interrupted)
    try:
        if len(sys.argv) != 2:
            raise ValueError('Expected one commit SHA')
        deploy(sys.argv[1])
    except Exception as error:
        print(str(error) if isinstance(error, RuntimeError) else 'Deployment rejected; invalid input or preparation failed.', file=sys.stderr)
        raise SystemExit(1)
