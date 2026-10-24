# English report presentation

The product presents diligence reports, chat answers and calculation explanations
in English. Source quotations, source bytes, record IDs, financial inputs and
native locators retain their original representation.

Two imported Enfuce reports were originally generated in Chinese. Their original
Firestore envelopes remain immutable. A private translation manifest supplies a
derived English view for `GET /deals/{id}/stored-reports/{report_id}/draft`.
The view keeps the original entry IDs, claim/citation relationships, source hashes
and exact quotations. Translation metadata identifies the original language,
source-record digest, manifest digest and model; it is not human verification.

The manifest is read from `INGENIUM_ENGLISH_TRANSLATIONS` when configured,
otherwise `/etc/ingenium/english-translations.json` if present, or
`backend/.cache/english-translations.json` for local development. Keep this file
private and out of Git. The existing runtime identity needs read access only.
No Firestore record is changed when a translated view is loaded.

Each report is bound to the SHA-256 of its complete original record, and each
translated string is keyed by the original text's SHA-256. Missing or stale
translations fail explicitly. Numeric validation permits equivalent language
notation, such as `800万` and `8 million`, and rejects numeric values absent from
the original prose. This validation does not independently verify translation
meaning or financial claims.

To prepare a manifest from a private export of the existing report envelopes:

```sh
python backend/scripts/prepare_english_presentations.py \
  --input /private/path/report-envelopes.json \
  --output /private/path/english-translations.json \
  --env-file /private/path/backend.env
```

The input has `narrative_reports: [{schema_version, record_sha256, record}, ...]`.
The command uses the existing Nicrron model connection, validates translations,
retains successful work for replay, and never writes to Firestore. Do not commit
the input, output, credentials or private source content.

The frontend can refresh previously loaded Chinese drafts by matching their
existing claim IDs and exact old text. It retains human edits, configuration,
citations and prior revision history, and records an English presentation
revision. Unknown human text is preserved rather than regenerated.
