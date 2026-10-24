import copy
import unittest

from backend.evidence.prepare_circle import register
from backend.evidence.import_claims import validate_claims, normalize


class EvidenceTests(unittest.TestCase):
    def test_only_quote_typography_and_whitespace_normalized(self):
        self.assertEqual(normalize('the “Initial Term”'), normalize("the 'Initial Term'"))
        self.assertNotEqual(normalize('three years'), normalize('four years'))
        self.assertNotEqual(normalize('a sentence ... ends'), normalize('a sentence starts and ends'))

    @classmethod
    def setUpClass(cls):
        cls.registry = register()
        cls.packet = {"source_sha256": cls.registry["contract"]["sha256"],
                      "pages": [{"physical_page": n} for n in range(350, 393)]}

    def payload(self):
        # Test fixture only, never presented as a real model extraction.
        return {"claims": [{"subject_entity_id": "circle_contracting", "claim_type": "termination",
                            "statement": "The agreement automatically terminates if no Applicable Stablecoins remain in circulation.",
                            "effective_date": None, "limitations": ["Other provisions remain unreviewed."],
                            "evidence": [{"physical_page": 367, "section": "3.2(g)",
                                          "quote": "This Agreement will automatically terminate if there are no Applicable Stablecoins remaining in circulation."}]}],
                "open_questions": []}

    def test_source_registry_and_contracting_entity(self):
        self.assertGreater(len(self.registry["files"]), 0)
        entities = {e["entity_id"]: e for e in self.registry["entities"]}
        self.assertNotEqual(entities["circle_issuer"]["legal_name"], entities["circle_contracting"]["legal_name"])
        self.assertEqual(self.registry["contract"]["physical_page_range"], [350, 392])

    def test_quote_located_on_real_pdf_and_ids_stable(self):
        first = validate_claims(self.payload(), self.registry, self.packet, "test-fixture")
        second = validate_claims(self.payload(), self.registry, self.packet, "test-fixture")
        self.assertEqual(first["claims"], second["claims"])
        self.assertEqual(first["evidence"][0]["locator"]["physical_page"], 367)
        self.assertEqual(first["claims"][0]["verification_status"], "source_located_requires_semantic_review")

    def test_invented_quote_and_wrong_page_rejected(self):
        for quote, page in [("The agreement has no conditions at all.", 367),
                            (self.payload()["claims"][0]["evidence"][0]["quote"], 364)]:
            payload = self.payload()
            payload["claims"][0]["evidence"][0].update(quote=quote, physical_page=page)
            with self.assertRaisesRegex(ValueError, "Quote not found"):
                validate_claims(payload, self.registry, self.packet, "test-fixture")

    def test_contents_unknown_entities_and_wrong_hash_rejected(self):
        payload = self.payload()
        payload["claims"][0]["evidence"][0]["physical_page"] = 351
        with self.assertRaisesRegex(ValueError, "Unsupported page"):
            validate_claims(payload, self.registry, self.packet, "test-fixture")
        payload = self.payload()
        payload["claims"][0]["subject_entity_id"] = "made-up"
        with self.assertRaisesRegex(ValueError, "Unknown entity"):
            validate_claims(payload, self.registry, self.packet, "test-fixture")
        packet = copy.deepcopy(self.packet)
        packet["source_sha256"] = "wrong"
        with self.assertRaisesRegex(ValueError, "hash mismatch"):
            validate_claims(self.payload(), self.registry, packet, "test-fixture")
