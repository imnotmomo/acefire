"""Present source-bound calculation/profile provenance without doing arithmetic.

All displayed values, formulas and locators come directly from the stored
contracts. This module does not read files, run formulas or infer metric roles.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any, Iterable
from urllib.parse import quote, urlsplit

from .schemas import Calculation, Observation, SourceSnapshot


def _index(records: Iterable[Any], label: str) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for record in records:
        previous = result.get(record.id)
        if previous is not None and previous.model_dump(mode="json") != record.model_dump(mode="json"):
            raise ValueError(f"Conflicting {label} records for ID {record.id}")
        result[record.id] = record
    return result


def _source(snapshot: SourceSnapshot, locator: dict[str, Any] | None = None) -> dict[str, Any]:
    name = snapshot.original_filename
    if not name and snapshot.local_path:
        name = Path(snapshot.local_path).name
    if not name:
        relative = snapshot.context.get("relative_path")
        name = Path(relative).name if isinstance(relative, str) else None
    if not name:
        name = Path(urlsplit(snapshot.source_uri).path).name or snapshot.id
    return {
        "snapshot_id": snapshot.id,
        "file_name": name,
        "sha256": snapshot.sha256,
        "provider": snapshot.provider,
        "ingestion_channel": snapshot.ingestion_channel,
        "data_role": snapshot.data_role,
        "visibility": snapshot.visibility,
        "preview_url": f"/sources/{quote(snapshot.id, safe='')}/file",
        "locator": locator,
    }


def _file_node(source: dict[str, Any], order: int) -> dict[str, Any]:
    return {
        "id": f"file:{source['snapshot_id']}",
        "type": "input",
        "position": {"x": 0, "y": order * 160},
        "data": {"kind": "source_file", "label": source["file_name"], **source},
    }


def build_calculation_lineage(
    calculation: Calculation,
    observations: list[Observation],
    snapshots: list[SourceSnapshot],
) -> dict[str, Any]:
    """Return full structured inputs and a React Flow file→number→calculation graph.

    A failed/not-applicable calculation with no inputs has an empty graph and
    retains its reasons. References to absent inputs/files always fail explicitly.
    """
    observation_index = _index(observations, "observation")
    snapshot_index = _index(snapshots, "snapshot")
    calculated = calculation.model_dump(mode="json")
    response: dict[str, Any] = {
        "calculation": calculated,
        "inputs": [],
        "sources": [],
        "nodes": [],
        "edges": [],
        "reasons": list(calculation.reasons),
        "explanation_steps": [],
    }
    for snapshot_id in calculation.input_snapshots:
        source = snapshot_index.get(snapshot_id)
        if source is None:
            raise ValueError(f"Missing calculation source snapshot: {snapshot_id}")
        if source.deal_id != calculation.deal_id:
            raise ValueError("Calculation source snapshot belongs to another deal")
    if not calculation.input_ids:
        if calculation.status == "succeeded":
            raise ValueError("Successful calculation has no traceable inputs")
        return response

    file_nodes: dict[str, dict[str, Any]] = {}
    number_nodes: list[dict[str, Any]] = []
    calculation_node_id = f"calculation:{calculation.id}"
    for order, observation_id in enumerate(calculation.input_ids, start=1):
        observation = observation_index.get(observation_id)
        if observation is None:
            raise ValueError(f"Missing calculation input observation: {observation_id}")
        snapshot = snapshot_index.get(observation.snapshot_id)
        if snapshot is None:
            raise ValueError(f"Missing source snapshot for input {observation_id}: {observation.snapshot_id}")
        if observation.deal_id != calculation.deal_id or snapshot.deal_id != calculation.deal_id:
            raise ValueError("Calculation input/source belongs to another deal")
        if snapshot.entity_key != observation.entity_key:
            raise ValueError(f"Input and source entity mapping disagree: {observation_id}")
        full_observation = observation.model_dump(mode="json")
        locator = full_observation["locator"]
        source = _source(snapshot, locator)
        role = observation.definition_key or f"input_{order}"
        role_basis = "reviewed_definition_key" if observation.definition_key else "input_index"
        response["inputs"].append({
            "input_order": order,
            "input_role": role,
            "role_basis": role_basis,
            "observation": full_observation,
            "source": source,
        })
        response['explanation_steps'].append({
            'step': order, 'kind': 'source_normalization',
            'observation_id': observation.id, 'source': source,
            'raw_value': full_observation['raw_value'],
            'scale_multiplier': full_observation['scale_multiplier'],
            'normalized_value': full_observation['value'],
            'unit': observation.unit, 'currency': observation.currency,
            'normalization_basis': observation.normalization_basis,
            'normalization_status': observation.normalization_status,
            'presentation_only': True,
        })
        if snapshot.id not in file_nodes:
            # File nodes have no single cell locator: several input cells can
            # refer to the same immutable physical snapshot.
            file_source = _source(snapshot)
            file_nodes[snapshot.id] = _file_node(file_source, len(file_nodes))
            response["sources"].append(file_source)
        number_id = f"number:{observation.id}:{order}"
        displayed = full_observation["value"]
        if displayed is None:
            displayed = full_observation["raw_value"]
        number_nodes.append({
            "id": number_id,
            "type": "default",
            "position": {"x": 360, "y": (order - 1) * 160},
            "data": {
                "kind": "source_observation",
                "label": observation.raw_label,
                "display_value": displayed,
                "file_name": source["file_name"],
                "input_order": order,
                "input_role": role,
                "role_basis": role_basis,
                "observation": full_observation,
                "source": source,
            },
        })
        edge_data = {"input_order": order, "input_role": role, "role_basis": role_basis}
        response["edges"].extend([
            {
                "id": f"file-number:{calculation.id}:{order}",
                "source": f"file:{snapshot.id}", "target": number_id,
                "type": "smoothstep", "data": {"relation": "reports", **edge_data},
            },
            {
                "id": f"number-calculation:{calculation.id}:{order}",
                "source": number_id, "target": calculation_node_id,
                "type": "smoothstep", "label": role,
                "data": {"relation": "calculation_input", **edge_data},
            },
        ])
    response["nodes"] = [*file_nodes.values(), *number_nodes, {
        "id": calculation_node_id,
        "type": "output",
        "position": {"x": 760, "y": (len(number_nodes) - 1) * 80},
        "data": {
            "kind": "calculation", "label": calculation.metric_key,
            "formula": calculation.formula, "value": calculated["value"],
            "unit": calculation.unit, "calculation": calculated,
        },
    }]
    response['explanation_steps'].extend([
        {'step': len(calculation.input_ids) + 1, 'kind': 'reviewed_formula',
         'formula': calculation.formula, 'function_key': calculation.function_key,
         'function_version': calculation.function_version, 'parameters': calculation.parameters},
        {'step': len(calculation.input_ids) + 2, 'kind': 'stored_result',
         'value': calculated['value'], 'unit': calculation.unit,
         'status': calculation.status, 'reasons': list(calculation.reasons)},
    ])
    return response


def _pointer_token(value: str) -> str:
    return value.replace("~", "~0").replace("/", "~1")


def _profile_fields(value: Any, pointer: str = ""):
    if isinstance(value, dict) and value:
        for key, item in value.items():
            yield from _profile_fields(item, pointer + "/" + _pointer_token(str(key)))
    elif isinstance(value, list) and value:
        for index, item in enumerate(value):
            yield from _profile_fields(item, pointer + "/" + str(index))
    else:
        # Nulls and empty collections remain explicit source values.
        yield pointer, value


def build_profile_lineage(profiles: list[dict], snapshots: list[SourceSnapshot]) -> dict[str, Any]:
    """Trace each profile field separately; conflicting sources never overwrite.

    Input records have Ledger.profiles() shape: snapshot_id/provider/profile.
    ``json_pointer_base`` must describe the stored wrapper, e.g. /response/data
    for saved Akta responses or /data for a direct live API response.
    """
    snapshot_index = _index(snapshots, "snapshot")
    response: dict[str, Any] = {"fields": [], "sources": [], "nodes": [], "edges": []}
    file_nodes: dict[str, dict[str, Any]] = {}
    field_nodes: list[dict[str, Any]] = []
    seen_fields: dict[tuple[str, str], Any] = {}
    for profile_record in profiles:
        snapshot_id = profile_record.get("snapshot_id")
        snapshot = snapshot_index.get(snapshot_id)
        if snapshot is None:
            raise ValueError(f"Missing profile source snapshot: {snapshot_id}")
        if profile_record.get("provider", snapshot.provider) != snapshot.provider:
            raise ValueError(f"Profile provider disagrees with source snapshot: {snapshot_id}")
        profile = profile_record.get("profile")
        if not isinstance(profile, dict):
            raise ValueError(f"Profile payload must be an object: {snapshot_id}")
        base = snapshot.context.get("json_pointer_base", snapshot.context.get("profile_json_pointer"))
        if base is None and snapshot.source_kind == "provider_json_api":
            base = "/data"
        if not isinstance(base, str) or (base and not base.startswith("/")):
            raise ValueError(f"Profile source lacks an explicit JSON pointer base: {snapshot_id}")
        base = base.rstrip("/")
        if snapshot.id not in file_nodes:
            source = _source(snapshot)
            file_nodes[snapshot.id] = _file_node(source, len(file_nodes))
            response["sources"].append(source)
        for field_path, value in _profile_fields(profile):
            locator = {"kind": "json_pointer", "pointer": base + field_path}
            identity = (snapshot.id, field_path)
            if identity in seen_fields:
                if type(seen_fields[identity]) is not type(value) or seen_fields[identity] != value:
                    raise ValueError(f"Conflicting profile fields for source {snapshot_id}: {field_path}")
                continue
            seen_fields[identity] = value
            source = _source(snapshot, locator)
            field = {"field_path": field_path, "value": value, "source": source}
            response["fields"].append(field)
            node_id = f"field:{snapshot.id}:{field_path}"
            field_nodes.append({
                "id": node_id, "type": "default",
                "position": {"x": 360, "y": (len(field_nodes)) * 100},
                "data": {"kind": "profile_field", "label": field_path or "/", **field},
            })
            response["edges"].append({
                "id": f"profile-field:{snapshot.id}:{field_path}",
                "source": f"file:{snapshot.id}", "target": node_id,
                "type": "smoothstep", "data": {"relation": "reports", "locator": locator},
            })
    response["nodes"] = [*file_nodes.values(), *field_nodes]
    return response
