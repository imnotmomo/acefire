import argparse
from datetime import date
import json

from app.akta import AktaClient, AktaError, ingest_akta_circle
from app.config import akta_data_root, cache_root, data_root, database_path
from app.akta_saved import ingest_saved_akta_circle
from app.local_sources import ingest_local_circle
from app.schemas import CIRCLE
from app.store import Store
from app.source_replay import replay_balance_sheet


def main():
    parser = argparse.ArgumentParser(description='Acefire source intake tools')
    commands = parser.add_subparsers(dest='command', required=True)
    commands.add_parser('init-db')
    ingest = commands.add_parser('ingest-circle')
    group = ingest.add_mutually_exclusive_group(required=True)
    group.add_argument('--local', action='store_true')
    group.add_argument('--akta', action='store_true')
    group.add_argument('--akta-saved', action='store_true')
    commands.add_parser('overview')
    commands.add_parser('demo-circle')
    args = parser.parse_args()
    store = Store(database_path())
    store.initialize()
    if args.command == 'init-db':
        print('Shared schema initialized.')
    elif args.command == 'demo-circle':
        primary = ingest_saved_akta_circle(akta_data_root())
        fixtures = ingest_local_circle(data_root() / CIRCLE.deal_id)
        primary_saved, uploads_saved = store.ingest(primary), store.ingest(fixtures)
        native = next(s for s in fixtures.snapshots if s.provider == 'orbis' and s.source_kind == 'native_provider_export_xlsx')
        values = [o for o in store.observations(CIRCLE.deal_id) if o.snapshot_id == native.id]
        result = replay_balance_sheet(values, CIRCLE.deal_id, date(2024, 12, 31))
        store.save_calculation(result)
        print(json.dumps({'primary_company': primary.company.model_dump(mode='json'), 'akta': primary_saved, 'upload_demo': uploads_saved, 'calculation': result.model_dump(mode='json'), 'lineage_url': f'/calculations/{result.id}/lineage'}, indent=2))
    elif args.command == 'ingest-circle':
        if args.local:
            result = ingest_local_circle(data_root() / CIRCLE.deal_id)
        elif args.akta_saved:
            try:
                result = ingest_saved_akta_circle(akta_data_root())
            except AktaError as error:
                parser.exit(1, str(error) + '\n')
        else:
            client = None
            try:
                client = AktaClient()
                result = ingest_akta_circle(client, cache_root())
            except AktaError as error:
                parser.exit(1, str(error) + '\n')
            finally:
                if client:
                    client.close()
        print(json.dumps({**store.ingest(result), 'warnings': result.warnings}, indent=2))
    else:
        rows = store.observations(CIRCLE.deal_id)
        print(json.dumps({'company': CIRCLE.legal_name, 'observations': len(rows), 'providers': {p: sum(x.provider == p for x in rows) for p in ['orbis', 'pitchbook', 'akta']}}, indent=2))


if __name__ == '__main__':
    main()
