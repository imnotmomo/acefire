import copy
import json
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.evidence.prepare_circle import ROOT, sha256
from backend.evidence.prepare_pdf import prepare_pdf, validate_entities
from backend.evidence.import_claims import validate_claims
from backend.evidence.extract_nicrron import build_messages
from backend.evidence.ingest_pdf import ingest
from backend.evidence.process_contract import process_prepared


PDF = ROOT / "data/additional-cases/marqeta-2024/originals/marqeta_q4_fy2024_earnings_release_issuer_rendering.pdf"


class GenericPdfTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.root = Path(cls.temp.name)
        cls.source = cls.root / "input.pdf"
        shutil.copyfile(PDF, cls.source)
        cls.prepared = cls.root / "prepared"
        cls.summary = prepare_pdf(cls.source, "different-company", cls.prepared, batch_size=3, scale=0.5,
                                  company_name="Marqeta", document_type="report")
        cls.registry = json.loads((cls.prepared / "registry.json").read_text())
        cls.packet = json.loads((cls.prepared / "packet.json").read_text())

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def payload(self):
        return {"claims": [{"subject_entity_id": None, "subject_entity_name": "Marqeta, Inc.",
                            "claim_type": "business", "statement": "Fixture for source-location verification only.",
                            "effective_date": None, "limitations": [], "evidence": [{"physical_page": 1,
                            "section": None, "quote": self.packet["pages"][0]["text"][:100]}]}], "open_questions": []}

    def test_all_pages_and_context_batches_without_circle_metadata(self):
        self.assertEqual(self.summary["prepared_pages"], 7)
        self.assertFalse(self.summary["model_called"])
        self.assertEqual([b["target_pages"] for b in self.packet["batches"]], [[1, 2, 3], [4, 5, 6], [7]])
        self.assertEqual(self.packet["batches"][1]["context_pages"], [3, 4, 5, 6, 7])
        self.assertNotIn("contract", self.registry)
        self.assertEqual(self.registry["entities"], [])
        messages = build_messages(self.prepared, self.packet, self.registry, self.packet["batches"][0])
        self.assertNotIn("Circle Internet", json.dumps(messages))
        self.assertEqual(sum(p["type"] == "image_url" for p in messages[1]["content"]), 4)

    def test_source_snapshot_survives_original_change(self):
        before = self.source.read_bytes()
        try:
            self.source.write_bytes(b"changed original")
            snapshot = Path(self.registry["document"]["file_path"])
            self.assertEqual(sha256(snapshot), self.registry["document"]["sha256"])
            bundle = validate_claims(self.payload(), self.registry, self.packet, "test-fixture")
            self.assertEqual(bundle["claims"][0]["entity_resolution_status"], "unresolved")
        finally:
            self.source.write_bytes(before)

    def test_unresolved_names_retained_and_fake_known_id_rejected(self):
        bundle = validate_claims(self.payload(), self.registry, self.packet, "test-fixture")
        self.assertEqual(bundle["claims"][0]["subject_entity_name"], "Marqeta, Inc.")
        payload = self.payload()
        payload["claims"][0]["subject_entity_name"] = None
        with self.assertRaises(ValueError):
            validate_claims(payload, self.registry, self.packet, "test-fixture")
        payload = self.payload()
        payload["claims"][0]["subject_entity_id"] = "invented-id"
        with self.assertRaisesRegex(ValueError, "Unknown entity"):
            validate_claims(payload, self.registry, self.packet, "test-fixture")

    def test_contents_exclusion_is_metadata_driven_not_fixed_page_number(self):
        registry = copy.deepcopy(self.registry)
        registry["document"]["excluded_evidence_pages"] = [1]
        with self.assertRaisesRegex(ValueError, "Unsupported page"):
            validate_claims(self.payload(), registry, self.packet, "test-fixture")

    def test_different_file_provenance_has_different_evidence_ids(self):
        first = validate_claims(self.payload(), self.registry, self.packet, "test-fixture")
        registry = copy.deepcopy(self.registry)
        registry["document"]["file_id"] = "different-origin-file"
        second = validate_claims(self.payload(), registry, self.packet, "test-fixture")
        self.assertNotEqual(first["evidence"][0]["evidence_id"], second["evidence"][0]["evidence_id"])

    def test_invalid_input_range_and_overwrite_fail_before_rendering(self):
        for first, last in [(0, 1), (1, 8), (3, 2)]:
            with self.assertRaises(ValueError):
                prepare_pdf(self.source, "test", self.root / f"bad-{first}-{last}", first=first, last=last)
        with self.assertRaisesRegex(ValueError, "Output exists"):
            prepare_pdf(self.source, "test", self.prepared)
        with self.assertRaisesRegex(ValueError, "PDF header"):
            fake = self.root / "fake.pdf"
            fake.write_bytes(b"not a PDF")
            prepare_pdf(fake, "test", self.root / "bad-header")
        with self.assertRaises(ValueError):
            validate_entities([{"entity_id": "same", "legal_name": "A"}, {"entity_id": "same", "legal_name": "B"}])

    @patch("backend.integrations.nicrron.urlopen")
    def test_general_entry_prepares_without_network(self, open_url):
        status = ingest(self.source, "generic-cli-test", self.root / "entry-test", first=1, last=1)
        self.assertEqual(status["status"], "prepared_not_model_extracted")
        self.assertFalse(status["network_called"])
        open_url.assert_not_called()

    @patch("backend.integrations.nicrron.urlopen")
    def test_collect_missing_batches_reports_failure_without_network(self, open_url):
        output = self.root / "missing-results"
        output.mkdir()
        result = process_prepared(self.prepared, output, collect_only=True)
        self.assertEqual(result["coverage"]["failed_target_pages"], list(range(1, 8)))
        self.assertFalse(result["coverage"]["all_batches_processed"])
        self.assertNotIn("Circle", (output / "REPORT.md").read_text())
        open_url.assert_not_called()
