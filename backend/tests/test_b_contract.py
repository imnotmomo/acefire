import unittest
import tempfile
from pathlib import Path

from backend.evidence.process_contract import aggregate, collect_batch
from backend.evidence.prepare_circle import register, write_json


class ContractAggregationTests(unittest.TestCase):
    def result(self, batch, pages, status="source_located_requires_semantic_review"):
        claim = {"subject_entity_id": "circle_contracting", "claim_type": "term", "statement": "A fact",
                 "evidence_ids": ["e1"], "claim_id": "c1", "extraction_batch_ids": [batch], "request_ids": [batch]}
        return {"batch_id": batch, "target_pages": pages, "status": status,
                "claims": [claim] if status != "failed" else [],
                "evidence": [{"evidence_id": "e1", "locator": {"physical_page": 364}}] if status != "failed" else [],
                "open_questions": ["Check dependency"], "rejected": []}

    def registry(self):
        return {"schema_version": "test", "deal": {}, "entities": [], "contract": {"title": "Test"}}

    def test_duplicates_merge_provenance_without_claiming_exhaustiveness(self):
        bundle = aggregate([self.result("a", [363]), self.result("b", [364])], self.registry(), [363, 364])
        self.assertEqual(len(bundle["claims"]), 1)
        self.assertEqual(bundle["claims"][0]["extraction_batch_ids"], ["a", "b"])
        self.assertEqual(bundle["open_questions"], ["Check dependency"])
        self.assertTrue(bundle["coverage"]["all_batches_processed"])

    def test_failed_batch_never_counts_as_covered(self):
        bundle = aggregate([self.result("a", [363]), self.result("b", [364], "failed")], self.registry(), [363, 364])
        self.assertFalse(bundle["coverage"]["all_batches_processed"])
        self.assertEqual(bundle["coverage"]["failed_target_pages"], [364])

    def test_distinct_conditions_remain_separate(self):
        first, second = self.result("a", [363]), self.result("b", [364])
        second["claims"][0]["statement"] = "A fact under a different condition"
        second["claims"][0]["claim_id"] = "c2"
        bundle = aggregate([first, second], self.registry(), [363, 364])
        self.assertEqual(len(bundle["claims"]), 2)

    def test_valid_context_claim_retained_and_invalid_claim_isolated(self):
        registry = register()
        packet = {"source_sha256": registry["contract"]["sha256"], "pages": [{"physical_page": 367}]}
        claim = {"subject_entity_id": "circle_contracting", "claim_type": "termination",
                 "statement": "The agreement terminates if no Applicable Stablecoins remain in circulation.",
                 "effective_date": None, "limitations": [], "evidence": [{"physical_page": 367,
                 "section": "3.2(g)", "quote": "This Agreement will automatically terminate if there are no Applicable Stablecoins remaining in circulation."}]}
        invalid = {**claim, "statement": "An invented claim", "evidence": [{"physical_page": 367, "section": None, "quote": "Invented quote with no original support."}]}
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            write_json(path / "request-manifest.json", {"requested_model": "test", "batch": {
                "batch_id": "fixture", "target_pages": [366], "context_pages": [366, 367]}})
            write_json(path / "raw-response.json", {"request_id": "fixture", "response": {"model": "test"}})
            write_json(path / "model-output.json", {"claims": [claim, invalid], "open_questions": []})
            result = collect_batch(path, registry, packet)
            self.assertEqual(len(result["claims"]), 1)
            self.assertEqual(result["claims"][0]["batch_page_role"], "context_only")
            self.assertEqual(len(result["rejected"]), 1)
            self.assertNotEqual(result["status"], "failed")
