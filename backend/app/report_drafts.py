"""Shared editable report workspaces, separate from immutable imported evidence."""
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from pydantic import Field, field_validator

from app.schemas import Contract
from app.report_storage import MAX_LOGICAL_BYTES, MAX_WORKSPACE_BYTES, canonical_bytes, section_count

MODULE_IDS = frozenset({'overview', 'market', 'financials', 'customers', 'product', 'competition',
                        'gtm', 'economics', 'team', 'legal', 'clinical', 'questions'})


def _text_list(value):
    return isinstance(value, list) and all(isinstance(item, str) for item in value)


def _config(value):
    return (isinstance(value, dict) and _text_list(value.get('topics'))
            and value.get('depth') in ('Brief', 'Standard', 'Deep')
            and value.get('scope') in ('Internal only', 'Internal + external')
            and all(isinstance(value.get(key), str) for key in ('geography', 'horizon', 'focus')))


def validate_workspace(value):
    """Structural editor contract only; human prose never becomes trusted evidence."""
    if not isinstance(value, dict):
        raise ValueError('Report workspace must be an object.')
    order, configs, sections, revisions = (value.get(key) for key in ('order', 'configs', 'sections', 'revisions'))
    if not _text_list(order) or len(order) != len(set(order)) or not set(order) <= MODULE_IDS:
        raise ValueError('Report workspace order must contain unique supported module IDs.')
    if not isinstance(configs, dict) or not set(configs) <= MODULE_IDS or not all(_config(config) for config in configs.values()):
        raise ValueError('Report workspace configs must map supported modules to complete editor settings.')
    if not isinstance(sections, list) or not all(isinstance(section, dict) for section in sections):
        raise ValueError('Report workspace sections must be an array of section objects.')
    ids = [section.get('id') for section in sections]
    if not all(isinstance(key, str) and key in MODULE_IDS for key in ids) or len(ids) != len(set(ids)):
        raise ValueError('Report workspace sections must have unique supported module IDs.')
    for section in sections:
        if (not all(isinstance(section.get(key), str) for key in ('title', 'content'))
                or not _text_list(section.get('evidenceIds')) or not _config(section.get('config'))):
            raise ValueError('Each report section needs title, content, evidenceIds and complete editor settings.')
        if 'sourceClaims' in section and (not isinstance(section['sourceClaims'], list) or not all(isinstance(claim, dict) for claim in section['sourceClaims'])):
            raise ValueError('Report section sourceClaims must be an array of claim objects.')
        if 'gaps' in section and not _text_list(section['gaps']):
            raise ValueError('Report section gaps must be an array of strings.')
    if not isinstance(revisions, list) or not all(isinstance(revision, dict) for revision in revisions):
        raise ValueError('Report workspace revisions must be an array of revision objects.')
    for revision in revisions:
        if (not all(isinstance(revision.get(key), str) for key in ('id', 'at', 'title', 'before', 'after', 'author'))
                or not isinstance(revision.get('section'), str) or revision['section'] not in MODULE_IDS):
            raise ValueError('Report revisions need an ID, timestamp, module and original/editor text fields.')
    if 'generatedAt' not in value or not (value['generatedAt'] is None or isinstance(value['generatedAt'], str)):
        raise ValueError('Report workspace generatedAt must be a string or null.')
    if len(canonical_bytes(value)) > MAX_WORKSPACE_BYTES:
        raise ValueError('Report workspace exceeds the 5 MB UTF-8 size limit. Your local draft is preserved.')
    return value


class DraftVersionConflict(ValueError):
    pass


class DraftWorkspaceUpdate(Contract):
    expected_version: int = Field(ge=1)
    workspace: dict[str, Any]

    @field_validator('workspace')
    @classmethod
    def bounded_workspace(cls, value):
        return validate_workspace(value)


class DraftWorkspaceCreate(Contract):
    based_on_report_id: str = Field(min_length=1, max_length=256)
    workspace: dict[str, Any]

    _bounded_workspace = field_validator('workspace')(DraftWorkspaceUpdate.bounded_workspace.__func__)


def now():
    return datetime.now(timezone.utc).isoformat()


def new_record(deal_id, based_on_report_id, *, draft=None, workspace=None):
    stamp = now()
    record = {'id': draft['id'] if draft else str(uuid4()), 'deal_id': deal_id,
              'version': 1, 'created_at': stamp, 'updated_at': stamp,
              'based_on_report_id': based_on_report_id,
              'model': draft.get('model') if draft else None,
              'draft': draft, 'workspace': workspace}
    validate_record(record)
    return record


def validate_record(record):
    validate_metadata(record)
    if ('draft' not in record or 'workspace' not in record or record['draft'] is None and record['workspace'] is None
            or record['draft'] is not None and not isinstance(record['draft'],dict)):
        raise ValueError('Shared report has no supported draft or editor workspace.')
    if record['draft'] is not None and 'sections' in record['draft']:
        sections=record['draft']['sections']
        if not isinstance(sections,list) or len(sections)>12 or not all(isinstance(section,dict) for section in sections):
            raise ValueError('Shared report has invalid section metadata.')
    if record.get('workspace') is not None:
        validate_workspace(record['workspace'])
    if len(canonical_bytes(record)) > MAX_LOGICAL_BYTES:
        raise ValueError('The complete shared report exceeds the 5 MB UTF-8 size limit, including its original draft and history. Your local draft is preserved.')


def validate_metadata(record):
    if not isinstance(record,dict) or type(record.get('version')) is not int or not 1<=record['version']<=9007199254740991:
        raise ValueError('Shared report has invalid version metadata.')
    for key in ('id','deal_id','created_at','updated_at','based_on_report_id'):
        if not isinstance(record.get(key),str) or not record[key].strip() or len(record[key])>(100 if key in ('created_at','updated_at') else 2048):
            raise ValueError('Shared report has incomplete identity or date metadata.')
    for key in ('created_at','updated_at'):
        try:datetime.fromisoformat(record[key].replace('Z','+00:00'))
        except ValueError:raise ValueError('Shared report has invalid date metadata.') from None
    if 'model' not in record or record.get('model') is not None and (not isinstance(record['model'],str) or not record['model'].strip() or len(record['model'])>2048):
        raise ValueError('Shared report has invalid model metadata.')


def updated_record(record, workspace):
    updated = {**record, 'version': record['version'] + 1, 'updated_at': now(), 'workspace': workspace}
    validate_record(updated)
    return updated


def summary(record):
    return {**{key: record[key] for key in ('id', 'deal_id', 'version', 'created_at',
                                           'updated_at', 'based_on_report_id', 'model')},
            'section_count': section_count(record),
            **({'unavailable': True} if record.get('unavailable') else {})}
