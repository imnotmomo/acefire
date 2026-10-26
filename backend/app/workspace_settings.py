"""Mutable workspace labels overlay the immutable legal/source identity."""
KEYS = {'display_name': 'workspace_display_name', 'sector': 'workspace_sector',
        'geography': 'workspace_geography', 'archived': 'workspace_archived'}


def overlay(company, settings):
    if company is None or not settings:
        return company
    identifiers = {**company.identifiers, **settings}
    return company.model_copy(update={'identifiers': identifiers})


def identity(company):
    record = company.model_dump(mode='json')
    record['identifiers'] = {key: value for key, value in company.identifiers.items() if key not in KEYS.values()}
    return record


def patch_settings(current, values):
    return {**current, **{KEYS[key]: ('true' if value else 'false') if key == 'archived' else value
                         for key, value in values.items()}}
