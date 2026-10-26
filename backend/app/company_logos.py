"""One-time, identity-bound favicon caching for newly created company workspaces."""
import asyncio
from concurrent.futures import ThreadPoolExecutor
import hashlib
import io
import ipaddress
import json
import os
from pathlib import Path
import re
from threading import BoundedSemaphore, RLock
from urllib.parse import quote, urlsplit
from uuid import uuid4

import httpx
from PIL import Image

from app.upload_lease import try_lock
from app.workspace_intake import upload_root

MAX_BYTES = 512 * 1024
_SAFE_ERRORS = {'lookup_failed','invalid_image','interrupted','queue_full','cache_unavailable'}
_SOCIAL = {'linkedin.com','facebook.com','instagram.com','twitter.com','x.com','youtube.com','tiktok.com'}


def normalize_public_domain(value):
    if not isinstance(value,str) or not value.strip() or len(value)>2048:
        raise ValueError('Supply a public company website.')
    value=value.strip()
    if any(char.isspace() or ord(char)<32 for char in value):
        raise ValueError('Company website must not contain whitespace or control characters.')
    try:
        parsed=urlsplit(value if '://' in value else 'https://'+value)
        if parsed.scheme.lower() not in ('http','https') or parsed.username is not None or parsed.password is not None or parsed.port is not None:
            raise ValueError
        host=(parsed.hostname or '').rstrip('.').encode('idna').decode('ascii').lower()
        if len(host)>253 or '.' not in host or any(not re.fullmatch(r'[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?',part) for part in host.split('.')):
            raise ValueError
        try:ipaddress.ip_address(host)
        except ValueError:pass
        else:raise ValueError
        if (host.rsplit('.',1)[-1].isdigit() or host.endswith(('.localhost','.local','.internal','.lan','.home','.corp','.invalid','.test','.example','.onion','.home.arpa','.in-addr.arpa','.ip6.arpa'))
                or any(host==site or host.endswith('.'+site) for site in _SOCIAL)):
            raise ValueError
        return host
    except (ValueError,UnicodeError):
        raise ValueError('Use a public company domain without credentials, ports, IP addresses or social-network links.') from None


def _identity(company):
    result={key:getattr(company,key,None) for key in ('deal_id','entity_key','legal_name','country')}
    if any(not isinstance(value,str) or not value.strip() for value in result.values()):
        raise ValueError('Company identity is incomplete.')
    result['domain']=normalize_public_domain(company.domain) if company.domain else ''
    return result


def _digest(value):
    return hashlib.sha256(json.dumps(value,sort_keys=True,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()


def _atomic(path,value):
    temporary=path.with_name(path.name+'.'+uuid4().hex+'.tmp')
    try:
        with temporary.open('xb') as output:
            os.chmod(temporary,0o600)
            output.write(value);output.flush();os.fsync(output.fileno())
        temporary.replace(path)
        if hasattr(os,'O_DIRECTORY'):
            descriptor=os.open(path.parent,os.O_RDONLY|os.O_DIRECTORY)
            try:os.fsync(descriptor)
            finally:os.close(descriptor)
    finally:temporary.unlink(missing_ok=True)


def _png(content):
    if not isinstance(content,bytes) or not content or len(content)>MAX_BYTES:
        raise ValueError('invalid_image')
    try:
        with Image.open(io.BytesIO(content)) as image:
            if image.format not in {'ICO','PNG','JPEG','WEBP','GIF','BMP','TIFF'} or not 0<image.width<=4096 or not 0<image.height<=4096 or image.width*image.height>4_000_000:
                raise ValueError
            image.seek(0);image.load()
            normalized=image.convert('RGBA');normalized.thumbnail((256,256))
            clean=Image.new('RGBA',normalized.size);clean.paste(normalized)
            normalized.close()
            try:
                output=io.BytesIO();clean.save(output,format='PNG',optimize=False)
                value=output.getvalue()
            finally:clean.close()
        if not value or len(value)>MAX_BYTES:raise ValueError
        return value
    except Exception:
        raise ValueError('invalid_image') from None


async def _download_async(domain):
    domain=normalize_public_domain(domain)
    async with asyncio.timeout(6):
        async with httpx.AsyncClient(timeout=6,follow_redirects=False,trust_env=False) as client:
            async with client.stream('GET',f'https://icons.duckduckgo.com/ip3/{domain}.ico',headers={'Accept':'image/*'}) as response:
                if response.status_code!=200:raise ValueError('lookup_failed')
                try:
                    if int(response.headers.get('Content-Length','0'))>MAX_BYTES:raise ValueError('lookup_failed')
                except (TypeError,ValueError):
                    if response.headers.get('Content-Length') not in (None,'0'):raise ValueError('lookup_failed') from None
                chunks=[];size=0
                async for chunk in response.aiter_bytes(16384):
                    size+=len(chunk)
                    if size>MAX_BYTES:raise ValueError('lookup_failed')
                    chunks.append(chunk)
                return b''.join(chunks)


def _download(domain):
    return asyncio.run(_download_async(domain))


def _source_domain(company,source):
    if (source.deal_id,source.entity_key)!=(company.deal_id,company.entity_key):return None
    path=Path(source.local_path) if source.local_path else None
    if path is None or path.suffix.lower() not in {'.txt','.md','.json'} or not path.is_file() or path.stat().st_size>256*1024:return None
    content=path.read_bytes()
    if hashlib.sha256(content).hexdigest()!=source.sha256:return None
    text=content.decode('utf-8-sig')
    blocks=[]
    if path.suffix.lower()=='.json':
        value=json.loads(text)
        if isinstance(value,dict):
            blocks=[value]+[value[key] for key in ('company','profile','firmographic') if isinstance(value.get(key),dict)]
    else:
        block={}
        for line in text.splitlines()[:100]:
            match=re.fullmatch(r'\s*\|?\s*\*{0,2}(company(?: name)?|legal[ _]name|website|country|sector)\*{0,2}\s*(?::|\|)\s*(.+?)\s*\|?\s*',line,re.I)
            if not match:
                if block:blocks.append(block);block={}
            else:block[match[1]]=match[2].strip().strip('*').strip()
        if block:blocks.append(block)
    candidates=set()
    for block in blocks:
        values={str(key).lower().replace('_',' ').strip():value for key,value in block.items()}
        name=next((values[key] for key in ('legal name','company name','company') if isinstance(values.get(key),str)),None)
        website=values.get('website')
        if name and ' '.join(name.casefold().split())==' '.join(company.legal_name.casefold().split()) and isinstance(website,str):
            try:candidates.add(normalize_public_domain(website))
            except ValueError:pass
    return next(iter(candidates)) if len(candidates)==1 else None


class CompanyLogoService:
    def __init__(self,root=None,fetcher=None):
        self.root=Path(root) if root is not None else upload_root()/'company-logos'
        self.root.mkdir(parents=True,exist_ok=True,mode=0o700)
        self.fetcher=fetcher or _download
        self.executor=ThreadPoolExecutor(max_workers=2,thread_name_prefix='company-logo')
        self.capacity=BoundedSemaphore(8);self.lock=RLock();self.closed=False

    def _paths(self,company):
        deal=company if isinstance(company,str) else company.deal_id
        if not isinstance(deal,str) or not deal or len(deal)>256:raise ValueError('Invalid company identity.')
        directory=self.root/hashlib.sha256(deal.encode()).hexdigest()
        return deal,directory,directory/'state.json'

    def _read(self,company):
        deal,directory,path=self._paths(company)
        if not path.is_file() or path.stat().st_size>64*1024:return None
        state=json.loads(path.read_text(encoding='utf-8'))
        if not isinstance(state,dict):return None
        identity=state.get('identity')
        if (state.get('schema_version')!=1 or not isinstance(identity,dict) or identity.get('deal_id')!=deal
                or state.get('identity_sha256')!=_digest(identity)
                or not isinstance(company,str) and identity!=_identity(company)):
            return None
        if (state.get('domain') is not None and normalize_public_domain(state['domain'])!=state['domain']
                or type(state.get('attempted')) is not bool or state.get('stage') not in {'prepared','committed'}):return None
        return state

    def _write(self,company,state):
        _atomic(self._paths(company)[2],json.dumps(state,ensure_ascii=False,sort_keys=True,allow_nan=False).encode())

    def _lease(self,company,create=False):
        _,directory,_=self._paths(company)
        if create:directory.mkdir(parents=True,exist_ok=True,mode=0o700)
        if not directory.is_dir():return None
        lease=(directory/'attempt.lock').open('a+b')
        if not try_lock(lease):lease.close();return None
        return lease

    def prepare(self,company):
        if company.identifiers.get('workspace_identity_status')!='user_supplied_unverified':return None
        identity=_identity(company);lease=self._lease(company,True)
        if lease is None:
            state=self._read(company)
            if state is None:raise ValueError('Another identity reserved this company logo.')
            return self.public(company)
        try:
            _,_,path=self._paths(company)
            if path.exists():
                if self._read(company) is None:raise ValueError('Another identity reserved this company logo.')
                return self.public(company)
            state={'schema_version':1,'identity':identity,'identity_sha256':_digest(identity),'stage':'prepared',
                   'domain':identity['domain'] or None,'attempted':False,'first_source_seen':False,
                   'status':'awaiting_website','sha256':None}
            self._write(company,state)
            return self.public(company)
        finally:lease.close()

    def _schedule(self,company,state,lease):
        if not state.get('domain') or state.get('attempted'):return False
        state.update(attempted=True,status='fetching',sha256=None)
        self._write(company,state)  # Durable claim precedes every outbound byte.
        if self.closed or not self.capacity.acquire(blocking=False):
            state.update(status='unavailable',error_code='queue_full');self._write(company,state);return False
        try:future=self.executor.submit(self._fetch,company,state,lease)
        except Exception:
            self.capacity.release();state.update(status='unavailable',error_code='interrupted');self._write(company,state);return False
        future.add_done_callback(lambda result:self._cancelled(result,company,state,lease))
        return True

    def _cancelled(self,future,company,state,lease):
        if future.cancelled():
            try:
                state.update(status='unavailable',error_code='interrupted');self._write(company,state)
            except Exception:pass
            finally:self.capacity.release();lease.close()

    def _fetch(self,company,state,lease):
        try:
            content=_png(self.fetcher(state['domain']))
            digest=hashlib.sha256(content).hexdigest()
            _atomic(self._paths(company)[1]/f'{digest}.png',content)
            state.update(status='ready',sha256=digest);state.pop('error_code',None)
            self._write(company,state)
        except Exception as error:
            state.update(status='unavailable',sha256=None,error_code='invalid_image' if str(error)=='invalid_image' else 'lookup_failed')
            try:self._write(company,state)
            except Exception:pass
        finally:self.capacity.release();lease.close()

    def commit(self,company):
        lease=None;transferred=False
        try:
            lease=self._lease(company)
            if lease is None:return self.public(company)
            state=self._read(company)
            if state is None:return None
            state['stage']='committed';self._write(company,state)
            transferred=self._schedule(company,state,lease)
            return self.public(company)
        except Exception:return self.public(company)
        finally:
            if lease is not None and not transferred:lease.close()

    def discard(self,company):
        lease=None
        try:
            lease=self._lease(company)
            if lease is None:return
            state=self._read(company)
            if state is not None and state.get('stage')=='prepared' and not state.get('attempted'):
                self._paths(company)[2].unlink(missing_ok=True)
        except Exception:pass
        finally:
            if lease is not None:lease.close()

    def after_source(self,company,source):
        lease=None;transferred=False
        try:
            if (source.deal_id,source.entity_key)!=(company.deal_id,company.entity_key):return self.public(company)
            lease=self._lease(company)
            if lease is None:return self.public(company)
            state=self._read(company)
            if state is None or state.get('attempted') or state.get('first_source_seen'):return self.public(company)
            state.update(first_source_seen=True,stage='committed')
            self._write(company,state)
            if not state.get('domain'):state['domain']=_source_domain(company,source)
            self._write(company,state)
            transferred=self._schedule(company,state,lease)
            return self.public(company)
        except Exception:return self.public(company)
        finally:
            if lease is not None and not transferred:lease.close()

    def set_website(self,company,website):
        domain=normalize_public_domain(website);lease=self._lease(company);transferred=False
        if lease is None:raise ValueError('This logo is already being processed or is not eligible.')
        try:
            state=self._read(company)
            if state is None or state.get('attempted'):
                raise ValueError('A logo website can be supplied only before this new company’s one-time lookup.')
            state.update(domain=domain,stage='committed');self._write(company,state)
            transferred=self._schedule(company,state,lease)
            return self.public(company)
        except OSError:
            raise ValueError('The company logo cache is unavailable. Retry later.') from None
        finally:
            if not transferred:lease.close()

    def public(self,company):
        try:
            state=self._read(company)
            if state is None:return None
            status=state.get('status');error=state.get('error_code')
            if status not in {'awaiting_website','fetching','ready','unavailable'}:return None
            if status=='fetching':
                path=self._paths(company)[1]/'attempt.lock'
                active=False
                if path.is_file() and not (os.name=='nt' and path.stat().st_size==0):
                    with path.open('r+b') as lease:active=not try_lock(lease)
                if not active:status='unavailable';error='interrupted'
            digest=state.get('sha256') if status=='ready' else None
            if digest:
                try:self.asset(company,digest)
                except ValueError:status='unavailable';digest=None;error='cache_unavailable'
            deal=self._paths(company)[0]
            return {'status':status,'domain':state.get('domain'),'sha256':digest,
                'asset_path':f'/deals/{quote(deal,safe="")}/logo/image/{digest}' if digest else None,
                **({'error_code':error} if error in _SAFE_ERRORS else {})}
        except Exception:return None

    def asset(self,company,sha256):
        if not isinstance(sha256,str) or re.fullmatch(r'[a-f0-9]{64}',sha256) is None:raise ValueError('Logo image is unavailable.')
        try:
            state=self._read(company)
            if state is None or state.get('status')!='ready' or state.get('sha256')!=sha256:raise ValueError
            path=self._paths(company)[1]/f'{sha256}.png'
            if not path.is_file() or path.stat().st_size>MAX_BYTES:raise ValueError
            content=path.read_bytes()
            if hashlib.sha256(content).hexdigest()!=sha256 or not content.startswith(b'\x89PNG\r\n\x1a\n'):raise ValueError
            return content
        except (OSError,ValueError,TypeError,AttributeError):raise ValueError('Logo image is unavailable.') from None

    def close(self):
        self.closed=True
        self.executor.shutdown(wait=False,cancel_futures=True)
