import copy
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from office_fixtures import write_docx, write_pptx
from backend.evidence.office_native import read_native
from backend.evidence.prepare_office import convert_office, prepare_office, resolve_soffice
from backend.evidence.ingest_document import ingest_document
from backend.evidence.import_claims import validate_claims


class NativeOfficeTests(unittest.TestCase):
    def test_word_paragraph_and_table_coordinates(self):
        with tempfile.TemporaryDirectory() as directory:
            native = read_native(write_docx(Path(directory) / "source.docx"))
            self.assertEqual(len(native["blocks"]), 3)
            table = native["blocks"][2]
            self.assertEqual(table["locator"]["paragraph_index"], 3)
            self.assertEqual(table["locator"]["table_index"], 1)
            self.assertEqual(table["locator"]["row_index"], 1)
            self.assertEqual(table["locator"]["xml_cell_index"], 1)
            self.assertNotIn("page", table["locator"])

    def test_powerpoint_uses_relationship_order_not_filenames(self):
        with tempfile.TemporaryDirectory() as directory:
            native = read_native(write_pptx(Path(directory) / "source.pptx"))
            self.assertEqual(native["slide_count"], 2)
            self.assertEqual(native["blocks"][0]["locator"]["slide_index"], 1)
            self.assertTrue(native["blocks"][0]["locator"]["part"].endswith("slide9.xml"))
            self.assertEqual(native["blocks"][1]["locator"]["slide_index"], 2)

    @patch("backend.evidence.prepare_office.resolve_soffice", side_effect=ValueError("Missing converter"))
    def test_missing_converter_is_explicit_and_never_calls_model(self, converter):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = write_docx(root / "source.docx")
            with self.assertRaisesRegex(ValueError, "Missing converter"):
                ingest_document(source, "test", root / "out")
            self.assertFalse((root / "out").exists())


class OfficeConversionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        try:
            cls.executable = resolve_soffice()
        except ValueError:
            raise unittest.SkipTest("LibreOffice is not installed")
        cls.temp = tempfile.TemporaryDirectory()
        cls.root = Path(cls.temp.name)
        cls.runs = {}
        for suffix, factory in (("docx", write_docx), ("pptx", write_pptx)):
            source = factory(cls.root / ("fixture." + suffix))
            summary = prepare_office(source, "synthetic-test", cls.root / suffix)
            prepared = Path(summary["prepared_run"])
            cls.runs[suffix] = (summary, json.loads((prepared / "registry.json").read_text()),
                                json.loads((prepared / "packet.json").read_text()))

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def payload(self):
        return {"claims": [{"subject_entity_id": None, "subject_entity_name": "Example Systems",
                            "claim_type": "business", "statement": "Example Systems provides payment software.",
                            "effective_date": None, "limitations": [], "evidence": [{"physical_page": 1,
                            "section": None, "quote": "Example Systems provides payment software."}]}], "open_questions": []}

    def test_office_sources_render_and_keep_native_locators(self):
        for suffix, expected_kind in (("docx", "docx_paragraph"), ("pptx", "pptx_paragraph")):
            summary, registry, packet = self.runs[suffix]
            self.assertFalse(summary["model_called"])
            self.assertEqual(summary["total_pdf_pages"], 1 if suffix == "docx" else 2)
            bundle = validate_claims(self.payload(), registry, packet, "test-fixture")
            evidence = bundle["evidence"][0]
            self.assertEqual(evidence["original_locator_status"], "unique")
            self.assertEqual(evidence["original_locators"][0]["kind"], expected_kind)
            self.assertEqual(evidence["source_sha256"], registry["document"]["original_sha256"])
            self.assertEqual(evidence["representation_sha256"], registry["document"]["sha256"])
            if suffix == "pptx":
                self.assertEqual(evidence["original_locators"][0]["slide_index"], 1)

    def test_native_locator_file_tampering_rejected(self):
        _, registry, packet = self.runs["docx"]
        registry = copy.deepcopy(registry)
        registry["document"]["native_blocks_sha256"] = "wrong"
        with self.assertRaisesRegex(ValueError, "Office source integrity mismatch"):
            validate_claims(self.payload(), registry, packet, "test-fixture")

    def test_legacy_word_and_powerpoint_conversion_paths(self):
        for suffix, target in (("docx", "doc"), ("pptx", "ppt")):
            source = self.root / ("fixture." + suffix)
            legacy = convert_office(source, self.root / ("legacy-" + target), target, self.executable)
            summary = prepare_office(legacy, "legacy-test", self.root / ("legacy-run-" + target))
            registry = json.loads((Path(summary["prepared_run"]) / "registry.json").read_text())
            self.assertEqual(registry["document"]["original_locator_origin"], "legacy_format_conversion")
            self.assertEqual(summary["source_format"], target)

    @patch.dict("os.environ", {"NICRRON_API_KEY": "test-fixture-key"})
    @patch("backend.integrations.nicrron.NicrronClient.complete")
    @patch("backend.integrations.nicrron.urlopen")
    def test_unified_word_entry_to_handoff_with_mock_model(self, open_url, complete):
        complete.return_value = {"request_id": "fixture-request", "response": {"model": "fixture-model",
            "choices": [{"finish_reason": "stop", "message": {"content": json.dumps(self.payload())}}]}}
        status = ingest_document(self.root / "fixture.docx", "end-to-end", self.root / "end-to-end",
                                 extract=True, workers=1)
        self.assertEqual(status["status"], "processed_requires_review")
        bundle = json.loads((self.root / "end-to-end/results/handoff.json").read_text())
        self.assertEqual(len(bundle["claims"]), 1)
        self.assertEqual(bundle["evidence"][0]["original_locators"][0]["paragraph_index"], 2)
        open_url.assert_not_called()
