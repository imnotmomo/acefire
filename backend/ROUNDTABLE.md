# Roundtable evidence workflow

**Current mode: code-only, disabled.** As requested, Roundtable is present in the
source but is not invoked by the product. `ROUNDTABLE_ENABLED` defaults to false.
Both Node entrypoints check this switch BEFORE loading the SDK or reading bot
credentials. Running them in the default mode only prints a disabled message:
no tasks, backend requests, uploads or remote profile registration occur.
The existing web chat continues to use Nicrron directly.

```bash
node roundtable/workers.mjs
node roundtable/ask.mjs enfuce-2020 'What does the company do?'
```

The remaining sections describe future opt-in setup. They have NOT been executed
as part of this code-only change. The personal research-bot memory connector in
Codex is separate from the product integration switch.

The SDK integration lives in `roundtable/`, separate from the CLI's machine
monitoring. It uses official `@roundtable/sdk` 0.1.1 and the bot identities minted
by `roundtable init --template diligence` from CLI 0.2.19.

## Provision bots

Save the Roundtable team/assistant key in a private local file (never Git or chat).
The machine login used by `roundtable setup` cannot replace this key. The CLI
expects `ROUNDTABLE_KEY`, or prompts for it with hidden input. The assistant key
must have a writable team bank: dashboard **Agents → Connect agent → Assistant**.
If several banks are writable, choose the intended one with `--project BANK`.

From the repository root:

```bash
roundtable init --template diligence runtime/roundtable-diligence
```

The official initializer provisions four identities and writes ignored `.env`:
`MEMO_WRITER_*` (coordinator), `COMPS_*` (answer worker), `RED_FLAGS_*` (file/citation
reviewer), and unused `MARKET_*`. Our worker profiles replace the template role
descriptions; no template market/comparables handlers or fictional Acme data
are imported, cited, or submitted to the existing database. The initializer itself
uploads labelled synthetic Acme starter files to the selected Roundtable bank.
Our answers live in a separate `acefire/chat/{run_id}/` namespace.

## Data transmission

Live execution uploads the selected question, source-cited answer, retrieved
excerpts (including original filenames, SHA-256 and locators) and review artifacts
to the authenticated team's bank at `https://roundtable.bot`. The team members
with bank access can see them. Original files and database credentials are not
uploaded by this adapter. Explicitly authorize the intended deal evidence to this
destination before enabling uploads. Prior Nicrron authorization is not Roundtable
authorization. Workers refuse all tasks without the upload flag and deal allowlist.

## Run after team configuration and data authorization

The existing local evidence API must be running on `127.0.0.1:8000` with its
Nicrron key and database configured (see CHAT.md). Keep its key out of Node.

```bash
cd roundtable
npm install --ignore-scripts --allow-remote=root
export ROUNDTABLE_ENABLED=true
export ROUNDTABLE_ALLOW_EVIDENCE_UPLOAD=1
export ACEFIRE_ROUNDTABLE_DEALS=enfuce-2020
npm run workers
```

In another terminal with the same three environment variables:

```bash
cd roundtable
npm run ask -- enfuce-2020 '根据2020年4月资料，Enfuce 的主要业务是什么？'
```

Set `ACEFIRE_ROUNDTABLE_ENV` to use another CLI-generated `.env` path. Credentials
are loaded from ignored runtime/roundtable-diligence/.env by default. The SDK
honors ROUNDTABLE_URL from that environment. Dispatch uses agent IDs, not ambiguous
names. Unknown deals are rejected before querying the local API.

## Flow and verification boundary

1. Coordinator dispatches question/deal/run ID to the answer worker.
2. Answer worker calls the existing `/deals/{id}/chat`. Nicrron generates and
   checks semantic support; no competing calculation engine is introduced.
3. Worker saves the answer plus evidence excerpts as a versioned Roundtable file.
   The task returns only the file Source (`bank`, `path`, `version`), keeping task
   input/result sizes bounded. This is also a private-data upload.
4. Coordinator passes that pinned Source to the reviewer. Reviewer reads the
   exact answer version, checks citation membership, re-reads the selected deal's
   source registry, and verifies original-file SHA-256 via the local API. It has
   no arbitrary URL, SQL, filesystem, or other-deal input capability.
5. Review is saved as another versioned file. Only after a passed review does the
   coordinator print the answer with original citations and Roundtable sources.

The reviewer checks file/citation integrity; it is not a separate independent
fact-checker. Source-support review still runs in the existing Nicrron workflow.
Failures block the task instead of falling back to fabricated or unreviewed facts.
The web `/chat` route continues to use the direct workflow; this additive CLI SDK
workflow is the first Roundtable integration and does not silently reroute web chat.
Bot names shown by the CLI template may retain generic names; their published
skills describe their Acefire roles. SDK workers must stay running to receive tasks.

## Local tests

```bash
node --test roundtable/tests/*.test.mjs
```

Tests do not need keys or upload data. They cover bounded deal access, upload
consent, missing/forged citations, pinned file versions, changed originals,
source/deal mismatches, arbitrary URL rejection and insufficiency handling.
