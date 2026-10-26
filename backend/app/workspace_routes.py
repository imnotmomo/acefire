"""Shared company workspaces and bounded, durable upload jobs (no login layer)."""
from __future__ import annotations
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
from threading import BoundedSemaphore, RLock
from typing import Literal
from uuid import uuid4

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import Field, BaseModel, ConfigDict, field_validator
from starlette.concurrency import run_in_threadpool

from app.schemas import Company, IngestionResult
from app.uploads import ingest_upload, MAX_UPLOAD_BYTES
from app.upload_lease import try_lock, unlock
from app.workspace_intake import SUPPORTED, atomic_json, process_upload, register_sources, upload_root

_SAFE_ID=re.compile(r'^[a-z0-9][a-z0-9_-]{0,119}$')


class WorkspaceRequest(BaseModel):
    model_config=ConfigDict(extra='forbid')
    name:str=Field(min_length=1,max_length=200)
    sector:str|None=Field(default=None,max_length=120)
    geography:str|None=Field(default=None,max_length=120)
    deal_id:str|None=Field(default=None,max_length=120)

    @field_validator('name')
    @classmethod
    def nonempty(cls,value):
        if not value.strip():raise ValueError('Company name must not be blank.')
        return value.strip()

    @field_validator('deal_id')
    @classmethod
    def safe_id(cls,value):
        if value is not None and not _SAFE_ID.fullmatch(value):raise ValueError('Company ID must use lowercase letters, digits, hyphens or underscores.')
        return value

    @field_validator('sector','geography')
    @classmethod
    def optional_text(cls,value):
        return value.strip() or None if value is not None else None


class WorkspacePatch(BaseModel):
    model_config = ConfigDict(extra='forbid')
    display_name: str | None = Field(default=None, min_length=1, max_length=200)
    sector: str | None = Field(default=None, min_length=1, max_length=120)
    geography: str | None = Field(default=None, min_length=1, max_length=120)
    archived: bool | None = None

    @field_validator('display_name', 'sector', 'geography', 'archived')
    @classmethod
    def supplied_value(cls, value):
        if value is None:
            raise ValueError('Supplied workspace fields must not be null.')
        if isinstance(value, str):
            value = value.strip()
            if not value:
                raise ValueError('Workspace labels must not be blank.')
        return value


def listed_companies(store):
    if hasattr(store,'companies'):return store.companies()
    with store._lock:
        ids=[r[0] for r in store._connect().execute('SELECT id FROM deals ORDER BY id').fetchall()]
    return [store.company(i) for i in ids]


class UploadJobs:
    def __init__(self,store,processor=None):
        self.store=store;self.processor=processor or process_upload
        self.root=upload_root();self.jobs=self.root/'jobs';self.jobs.mkdir(parents=True,exist_ok=True,mode=0o700)
        self.executor=ThreadPoolExecutor(max_workers=2,thread_name_prefix='workspace-upload')
        self.capacity=BoundedSemaphore(8);self.lock=RLock();self.closed=False;self.leases={}

    def active(self,job):
        if job.get('lease_protocol') == 1:
            if not re.fullmatch(r'[a-f0-9]{32}',str(job.get('id',''))):return False
            # The OS drops this lock on crash. Unlike a PID, it cannot be
            # mistaken for an unrelated later process or a restarted app.
            with (self.jobs/f'{job["id"]}.lock').open('a+b') as lease:
                if not try_lock(lease):return True
                unlock(lease)
                return False
        # Preserve jobs owned by a still-running older release during handoff.
        owner=job.get('owner_pid')
        # Windows os.kill(pid, 0) can terminate the process. Legacy receipts
        # without an OS lease cannot prove a live worker there; allow retry.
        if os.name!='nt' and isinstance(owner,int) and owner>0 and owner!=os.getpid():
            try:os.kill(owner,0);return True
            except ProcessLookupError:pass
            except PermissionError:return True
        return False

    def release(self,path,job,future):
        with self.lock:
            try:
                if future.cancelled():
                    failed={**job,'status':'failed','error':'The backend stopped before extraction began. Re-upload the retained original file to retry.',
                            'finished_at':datetime.now(timezone.utc).isoformat()}
                    try:atomic_json(path,failed)
                    finally:self.capacity.release()
            finally:
                lease=self.leases.pop(job['id'],None)
                if lease is not None:lease.close()

    def start(self):
        # Recover only at application startup. Importing another app for tests
        # must not relabel a running API process's upload jobs as failed.
        for path in self.jobs.glob('*.json'):
            try:
                job=json.loads(path.read_text())
                if job.get('status') in {'queued','processing'}:
                    if self.active(job):continue
                    job.update(status='failed',error='The backend restarted before this upload finished. Re-upload the original file to retry.')
                    atomic_json(path,job)
            except (OSError,ValueError):continue

    def public(self,job):
        return {k:v for k,v in job.items() if k not in {'source_path','owner_pid','lease_protocol'}}

    def close(self):
        self.closed=True
        self.executor.shutdown(wait=False,cancel_futures=True)

    def read(self,deal_id,job_id):
        if not re.fullmatch(r'[a-f0-9]{32}',job_id):raise HTTPException(404,'Upload job not found.')
        path=self.jobs/f'{job_id}.json'
        if not path.is_file():raise HTTPException(404,'Upload job not found.')
        try:
            with self.lock:job=json.loads(path.read_text())
        except (OSError,ValueError):
            raise HTTPException(409,'This upload receipt is unreadable. The original source is retained; re-upload it to retry extraction.') from None
        if job.get('deal_id')!=deal_id:raise HTTPException(404,'Upload job not found in this company.')
        return self.public(job)

    def submit(self,company,content,filename,content_type,provider):
        acquired=False
        try:
            with self.lock:
                if self.closed:raise HTTPException(503,'The upload worker is stopping. Retry shortly.')
                incoming=ingest_upload(content,filename,content_type,provider,company,self.root/'files')
                source=incoming.snapshots[0]
                # The lock covers lookup and scheduling, so duplicate active
                # requests cannot create two non-deterministic PDF/OCR runs.
                for path in self.jobs.glob('*.json'):
                    try:previous=json.loads(path.read_text())
                    except (OSError,ValueError):continue
                    if (previous.get('deal_id'),previous.get('snapshot_id'))!=(company.deal_id,source.id):continue
                    reusable=previous.get('status')=='completed'
                    if previous.get('status') in {'queued','processing'}:
                        reusable=self.active(previous)
                    if reusable:
                        register_sources([source])
                        self.store.ingest(IngestionResult(company=company,snapshots=[source],observations=[]))
                        return self.public(previous)
                if not self.capacity.acquire(blocking=False):raise HTTPException(429,'The upload queue is full. Retry after a current file finishes.')
                acquired=True
                # Original registration is independent of extraction success.
                register_sources([source]);self.store.ingest(IngestionResult(company=company,snapshots=[source],observations=[]))
                job={'id':uuid4().hex,'deal_id':company.deal_id,'status':'queued','snapshot_id':source.id,
                    'filename':source.original_filename,'sha256':source.sha256,'observations':0,'claims':0,
                    'warnings':[],'created_at':datetime.now(timezone.utc).isoformat(),'owner_pid':os.getpid(),'lease_protocol':1}
                path=self.jobs/f'{job["id"]}.json';atomic_json(path,job)
                lease=(self.jobs/f'{job["id"]}.lock').open('a+b')
                try:
                    if not try_lock(lease):raise ValueError('Upload worker lease is busy. Re-upload the original file to retry.')
                except BaseException:
                    lease.close()
                    raise
                self.leases[job['id']]=lease
                try:
                    future=self.executor.submit(self.run,path,job,company,source,incoming.observations)
                except BaseException:
                    self.leases.pop(job['id'],None);lease.close()
                    raise
                future.add_done_callback(lambda result:self.release(path,job,result))
                return self.public(job)
        except Exception:
            if acquired:self.capacity.release()
            raise

    def run(self,path,job,company,source,adapter_observations):
        try:
            job={**job,'status':'processing'};atomic_json(path,job)
            if adapter_observations:
                self.store.ingest(IngestionResult(company=company,snapshots=[],observations=adapter_observations))
                result={'snapshot_id':source.id,'observations':len(adapter_observations),'claims':0,'warnings':['Reviewed native Circle Orbis layout used; vendor definitions remain source-reported.']}
            else:
                result=self.processor(self.store,company,source,self.root/'runs'/job['id'])
            job.update(result,status='completed',finished_at=datetime.now(timezone.utc).isoformat())
        except Exception as error:
            # Provider/OS exceptions may contain keys or private paths. Public
            # status is deliberately generic; the original stays registered.
            message = 'Extraction could not finish. The original file is retained; check the supported format and backend extraction/OCR configuration, then re-upload to retry.'
            safe_limits = ('CSV exceeds', 'CSV needs', 'CSV record exceeds', 'Worksheet exceeds', 'Workbook exceeds', 'Image exceeds', 'Document exceeds', 'OCR supports', 'Image/scanned document reading needs')
            if isinstance(error, ValueError) and str(error).startswith(safe_limits):
                message = str(error)[:240] + ' The original file is retained.'
            job.update(status='failed',error=message,finished_at=datetime.now(timezone.utc).isoformat())
        finally:
            try:atomic_json(path,job)
            finally:self.capacity.release()


def workspace_router(store,*,processor=None):
    jobs=UploadJobs(store,processor)
    @asynccontextmanager
    async def lifespan(_):
        jobs.start()
        try:yield
        finally:jobs.close()
    router=APIRouter(lifespan=lifespan)
    router.upload_jobs=jobs

    @router.get('/deals')
    def list_workspaces(include_archived: bool = False):
        return {'companies':[company for company in listed_companies(store)
                             if include_archived or company.identifiers.get('workspace_archived') != 'true']}

    @router.patch('/deals/{deal_id}')
    def patch_workspace(deal_id: str, request: WorkspacePatch):
        values = request.model_dump(exclude_unset=True)
        if not values:
            raise HTTPException(422, 'Supply at least one workspace field to update.')
        try:
            company = store.patch_workspace(deal_id, values)
        except ValueError as error:
            raise HTTPException(409, str(error)) from None
        if company is None:
            raise HTTPException(404, 'Company workspace not found.')
        return {'company': company}

    @router.post('/deals',status_code=201)
    def create_workspace(request:WorkspaceRequest):
        key=request.deal_id or 'deal-'+uuid4().hex
        def matches(company):
            values=company.identifiers
            return (company.legal_name==request.name and values.get('workspace_identity_status')=='user_supplied_unverified'
                and values.get('workspace_sector')==(request.sector or 'Other')
                and values.get('workspace_geography')==(request.geography or 'Unknown'))
        existing=store.company(key)
        if existing is not None:
            if matches(existing):return {'company':existing}
            raise HTTPException(409,'This company workspace ID already exists with different metadata.')
        company=Company(deal_id=key,entity_key='workspace-'+key,legal_name=request.name,domain='',country=request.geography or 'Unknown',
            identifiers={'workspace_identity_status':'user_supplied_unverified','workspace_sector':request.sector or 'Other','workspace_geography':request.geography or 'Unknown','workspace_created_at':datetime.now(timezone.utc).isoformat(),'akta_lookup_status':'not_requested'})
        try:
            if hasattr(store,'create_company'):store.create_company(company)
            else:store.ingest(IngestionResult(company=company,snapshots=[],observations=[]))
        except ValueError as error:
            existing=store.company(key)
            if existing is not None and matches(existing):return {'company':existing}
            raise HTTPException(409,str(error)) from None
        return {'company':company}

    @router.post('/deals/{deal_id}/uploads',status_code=202)
    async def upload(deal_id:str,file:UploadFile=File(...),provider:Literal['orbis','pitchbook','uploaded']=Form('uploaded')):
        try:
            company=await run_in_threadpool(store.company,deal_id)
            if company is None:raise HTTPException(404,'Company workspace not found.')
            suffix=Path((file.filename or '').replace('\\','/').rsplit('/',1)[-1]).suffix.lower()
            if suffix not in SUPPORTED:raise HTTPException(415,'Supported files: PDF, Word, PowerPoint, images, CSV/TSV, Excel, TXT, Markdown and JSON.')
            content=await file.read(MAX_UPLOAD_BYTES+1)
            if len(content)>MAX_UPLOAD_BYTES:raise HTTPException(413,'File exceeds the 50 MiB upload limit.')
            return await run_in_threadpool(jobs.submit,company,content,file.filename or 'source',file.content_type,provider)
        except ValueError as error:raise HTTPException(422,str(error)) from None
        finally:await file.close()

    @router.get('/deals/{deal_id}/uploads')
    def list_uploads(deal_id:str):
        if store.company(deal_id) is None:raise HTTPException(404,'Company workspace not found.')
        values=[]
        for path in sorted(jobs.jobs.glob('*.json')):
            try:
                job=json.loads(path.read_text())
                if job.get('deal_id')==deal_id:values.append(jobs.public(job))
            except (OSError,ValueError):continue
        return {'uploads':values}

    @router.get('/deals/{deal_id}/uploads/{job_id}')
    def upload_status(deal_id:str,job_id:str):
        return jobs.read(deal_id,job_id)

    return router
