# Local AI for Zotero — Plan 1: Plugin Foundation + Single-Paper Chat

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Zotero plugin whose reader side pane lets the user chat with the open PDF using a local Ollama model. Answers cite numbered passages, clicking a citation jumps to and flashes the passage in the PDF, "Save" turns it into a real highlight annotation, and "how do I cite this?" returns a correctly formatted citation from Zotero metadata.

**Architecture:** A Zotero 7+ bootstrap plugin in `zotero-local-ai/`. Each source file is a small module that is (a) loaded into one shared scope by `bootstrap.js` via `Services.scriptloader.loadSubScript` and (b) `require`-able from Node for unit tests (`if (typeof module === 'object') module.exports = X`). Pure logic (chunking, vectors, prompt/citation parsing, positions, chat orchestration) has no Zotero dependency and is tested with Mocha in Node. Thin Zotero adapters (`extract.js`, `citations.js`, `highlight.js`, `chatPanel.js`, `main.js`) are verified in a development Zotero build. Text and page geometry come from Zotero's Structured Document Text (`Zotero.SDT`); embeddings and chat go through Ollama's HTTP API; data lives in its own SQLite file via `Zotero.DBConnection`.

**Tech Stack:** JavaScript (Firefox ESR / Zotero chrome context), Ollama HTTP API (`/api/tags`, `/api/embed`, `/api/chat`), Zotero plugin APIs (`ItemPaneManager`, `PreferencePanes`, `Reader`, `Annotations`, `QuickCopy`, `Translate.Export`, `SDT`, `DBConnection`), Node 20 + Mocha 10 + Chai 4 + sql.js for unit tests.

**Spec:** `docs/superpowers/specs/2026-11-23-zotero-local-ai-design.md` (build steps 1–2). Later plans: Plan 2 = background indexer + library/collection hybrid search; Plan 3 = MiniCPM-V OCR; Plan 4 = paper cards + entity graph; Plan 5 = optional graph view.

## Global Constraints

- Plugin folder: `zotero-local-ai/` at the repo root; the Zotero core source is not modified.
- Plugin ID: `local-ai@samuelesimone.github.io`. Pref prefix: `extensions.zotero-local-ai.`
- Display name: "Local AI for Zotero" (never "Zotero AI"; must not look official).
- Default models: chat `gemma4:12b`, embeddings `nomic-embed-text`, OCR `openbmb/minicpm-v4.6` (OCR unused in Plan 1). Default Ollama URL `http://localhost:11434`.
- Only external runtime dependency: Ollama. No npm runtime dependencies (devDependencies only for tests).
- DB file: `zotero-local-ai.sqlite` in the Zotero data directory (`new Zotero.DBConnection('zotero-local-ai')`).
- Citations are produced by Zotero's citation engine (Quick Copy style, fallback APA) — never by the LLM.
- PDFs only in v1. Files are never modified (annotations are Zotero items, not PDF edits).
- Code style (from repo CLAUDE.md): tabs, `let` instead of `const` except true scalar constants, no cuddled `else`/`catch`, `--` instead of em dashes in comments, async/await.
- Log prefix: `[LocalAI]` via `Zotero.debug`.

## Deviations from the spec (intentional, Plan 1 only)

- Embeddings are stored as base64 text in a `chunks.embedding` column instead of a separate `embeddings` BLOB table. This avoids uncertain typed-array binding in mozStorage; Plan 2 can migrate if it measures a need.
- Persistent "temporary overlays" are not built: the spec's fallback is used (Zotero's reader flashes a navigated `position` for 2 s, `reader/src/pdf/pdf-view.js` `_highlightPosition`).
- Indexing happens on demand for the open paper when the first question is asked. The background queue is Plan 2.

## File Structure

```
zotero-local-ai/
  package.json            dev scripts: test, build (xpi zip)
  .mocharc.json           mocha config
  .gitignore              node_modules/, build/
  manifest.json           Zotero plugin manifest
  updates.json            update manifest (required by update_url)
  bootstrap.js            lifecycle: loads src/*.js into one scope, starts LocalAI
  prefs.js                default prefs
  locale/en-US/zotero-local-ai.ftl   pane header/sidenav strings
  content/icons/ai16.svg, ai20.svg
  content/preferences.xhtml          prefs pane (Ollama URL, models)
  src/config.js           read prefs with defaults                       (Zotero)
  src/ollama.js           Ollama HTTP client + NDJSON stream reader       (pure, fetch injected)
  src/vectors.js          normalize, base64 encode/decode, topK, prefixes (pure)
  src/sdtPassages.js      SDT structure -> passages with page rects       (pure)
  src/chunker.js          passages -> chunks                              (pure)
  src/store.js            SQLite schema + queries over a db adapter       (pure, db injected)
  src/paperIndex.js       ensureIndexed(): extract -> chunk -> embed -> store (pure, deps injected)
  src/router.js           citation-question detection                     (pure)
  src/prompt.js           buildMessages(), parseCitations()               (pure)
  src/retriever.js        retrieveForPaper()                              (pure, deps injected)
  src/positions.js        chunk -> reader position / annotation JSON      (pure)
  src/chatController.js   ask(): routing, indexing, retrieval, streaming, errors (pure, deps injected)
  src/extract.js          Zotero.SDT -> passages                          (Zotero)
  src/citations.js        formatted citation + BibTeX                     (Zotero)
  src/highlight.js        open/navigate reader, save annotation           (Zotero)
  src/chatPanel.js        item-pane section UI in the reader              (Zotero)
  src/main.js             LocalAI object: init/shutdown/window hooks      (Zotero)
  test/helpers/sqljsAdapter.js
  test/*.test.js
  README.md
```

---

### Task 1: Dev environment + plugin skeleton that loads in Zotero

**Files:**
- Create: `zotero-local-ai/package.json`, `zotero-local-ai/.mocharc.json`, `zotero-local-ai/.gitignore`, `zotero-local-ai/manifest.json`, `zotero-local-ai/updates.json`, `zotero-local-ai/bootstrap.js`, `zotero-local-ai/prefs.js`, `zotero-local-ai/src/config.js`, `zotero-local-ai/src/main.js`, `zotero-local-ai/test/smoke.test.js`

**Interfaces:**
- Produces: `bootstrap.js` `FILES` array (later tasks append module names to it); global `LocalAI` with `init({id, version, rootURI})`, `shutdown()`, `addToWindow(win)`, `removeFromWindow(win)`; `Config.get(key)` for keys `ollamaURL | chatModel | embedModel | ocrModel`; `Config.DEFAULTS`.

- [ ] **Step 1: Build Zotero from source (one-time)**

Zotero isn't installed on this machine, and `Zotero.SDT` only exists in recent builds, so development runs against Zotero built from this repo.

```bash
cd /Users/samuelesimone/Documents/Progetti/ZoteroAI
app/scripts/check_requirements
npm install
app/scripts/fetch_xulrunner -p m
app/scripts/build_and_run -p LocalAIDev 2>&1 | tail -20
```
Expected: Zotero opens from `app/staging/Zotero.app`. If `-p LocalAIDev` reports that the profile doesn't exist, create it first with `app/staging/Zotero.app/Contents/MacOS/zotero -CreateProfile LocalAIDev` and rerun. Quit Zotero, then find the profile dir:
```bash
ls -d ~/Library/Application\ Support/Zotero/Profiles/*.LocalAIDev
```
Expected: one path printed. Write it down as `$PROFILE`.

- [ ] **Step 2: Create the package and test config**

`zotero-local-ai/package.json`:
```json
{
	"name": "zotero-local-ai",
	"version": "0.1.0",
	"private": true,
	"description": "Local AI for Zotero: local OCR, knowledge search and chat with Ollama",
	"scripts": {
		"test": "mocha",
		"build": "rm -rf build && mkdir -p build && zip -r build/zotero-local-ai.xpi manifest.json bootstrap.js prefs.js src content locale -x '*.DS_Store'"
	},
	"devDependencies": {
		"chai": "^4.5.0",
		"mocha": "^10.7.0",
		"sql.js": "^1.11.0"
	}
}
```

`zotero-local-ai/.mocharc.json`:
```json
{
	"spec": "test/**/*.test.js",
	"timeout": 5000
}
```

`zotero-local-ai/.gitignore`:
```
node_modules/
build/
```

Run: `cd zotero-local-ai && npm install`
Expected: installs without errors.

- [ ] **Step 3: Write the failing smoke test**

`zotero-local-ai/test/smoke.test.js`:
```js
const { assert } = require('chai');
const fs = require('fs');
const path = require('path');

describe('plugin manifest', function () {
	it('declares the Zotero plugin id and version', function () {
		let manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest.json'), 'utf8'));
		assert.equal(manifest.manifest_version, 2);
		assert.equal(manifest.applications.zotero.id, 'local-ai@samuelesimone.github.io');
		assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
	});

	it('lists only module files that exist', function () {
		let bootstrap = fs.readFileSync(path.join(__dirname, '..', 'bootstrap.js'), 'utf8');
		let files = JSON.parse(bootstrap.match(/const FILES = (\[[^\]]*\]);/)[1].replace(/'/g, '"'));
		for (let name of files) {
			assert.isTrue(fs.existsSync(path.join(__dirname, '..', 'src', name + '.js')), name);
		}
	});
});
```

- [ ] **Step 4: Run it to make sure it fails**

Run: `cd zotero-local-ai && npm test`
Expected: FAIL with `ENOENT ... manifest.json`.

- [ ] **Step 5: Write the manifest, update manifest and prefs**

`zotero-local-ai/manifest.json`:
```json
{
	"manifest_version": 2,
	"name": "Local AI for Zotero",
	"version": "0.1.0",
	"description": "Chat with your papers using local models via Ollama",
	"applications": {
		"zotero": {
			"id": "local-ai@samuelesimone.github.io",
			"update_url": "https://raw.githubusercontent.com/samuelesimone/zotero/feature/local-ai/zotero-local-ai/updates.json",
			"strict_min_version": "7.0",
			"strict_max_version": "11.*"
		}
	}
}
```

`zotero-local-ai/updates.json`:
```json
{
	"addons": {
		"local-ai@samuelesimone.github.io": {
			"updates": []
		}
	}
}
```

`zotero-local-ai/prefs.js`:
```js
pref("extensions.zotero-local-ai.ollamaURL", "http://localhost:11434");
pref("extensions.zotero-local-ai.chatModel", "gemma4:12b");
pref("extensions.zotero-local-ai.embedModel", "nomic-embed-text");
pref("extensions.zotero-local-ai.ocrModel", "openbmb/minicpm-v4.6");
```

- [ ] **Step 6: Write config, main and bootstrap**

`zotero-local-ai/src/config.js`:
```js
var Config = (() => {
	const PREFIX = 'extensions.zotero-local-ai.';
	let DEFAULTS = {
		ollamaURL: 'http://localhost:11434',
		chatModel: 'gemma4:12b',
		embedModel: 'nomic-embed-text',
		ocrModel: 'openbmb/minicpm-v4.6',
	};
	
	function get(key) {
		let value = Zotero.Prefs.get(PREFIX + key, true);
		return (value === undefined || value === '') ? DEFAULTS[key] : value;
	}
	
	return { get, DEFAULTS, PREFIX };
})();
if (typeof module === 'object') module.exports = Config;
```

`zotero-local-ai/src/main.js`:
```js
var LocalAI = {
	id: null,
	version: null,
	rootURI: null,
	
	log(msg) {
		Zotero.debug('[LocalAI] ' + msg);
	},
	
	async init({ id, version, rootURI }) {
		this.id = id;
		this.version = version;
		this.rootURI = rootURI;
		if (!Zotero.SDT) {
			this.log('Zotero.SDT is missing -- this Zotero build is too old for Local AI');
		}
		this.log(`started ${version}`);
	},
	
	async shutdown() {
		this.log('stopped');
	},
	
	addToWindow(win) {
		win.MozXULElement.insertFTLIfNeeded('zotero-local-ai.ftl');
	},
	
	removeFromWindow(win) {
		win.document.querySelector('[href="zotero-local-ai.ftl"]')?.remove();
	},
};
if (typeof module === 'object') module.exports = LocalAI;
```

`zotero-local-ai/bootstrap.js`:
```js
/* global Zotero, Services, Cu */
var LocalAI;

const FILES = ['config', 'main'];

function install() {}

async function startup({ id, version, rootURI }) {
	await Zotero.initializationPromise;
	Cu.importGlobalProperties(['fetch', 'atob', 'btoa', 'TextDecoder', 'TextEncoder']);
	let scope = { Zotero, Services, Cu, ChromeUtils, fetch, atob, btoa, TextDecoder, TextEncoder };
	for (let name of FILES) {
		Services.scriptloader.loadSubScript(rootURI + 'src/' + name + '.js', scope);
	}
	LocalAI = scope.LocalAI;
	await LocalAI.init({ id, version, rootURI });
	for (let win of Zotero.getMainWindows()) {
		LocalAI.addToWindow(win);
	}
}

function onMainWindowLoad({ window }) {
	LocalAI?.addToWindow(window);
}

function onMainWindowUnload({ window }) {
	LocalAI?.removeFromWindow(window);
}

async function shutdown() {
	if (!LocalAI) {
		return;
	}
	for (let win of Zotero.getMainWindows()) {
		LocalAI.removeFromWindow(win);
	}
	await LocalAI.shutdown();
	LocalAI = null;
}

function uninstall() {}
```

Create an empty `zotero-local-ai/locale/en-US/zotero-local-ai.ftl` (filled in Task 11) so `insertFTLIfNeeded` finds a file:
```
local-ai-name = Local AI
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd zotero-local-ai && npm test`
Expected: 2 passing.

- [ ] **Step 8: Install the plugin into the dev profile and see it start**

```bash
echo "/Users/samuelesimone/Documents/Progetti/ZoteroAI/zotero-local-ai/" > "$PROFILE/extensions/local-ai@samuelesimone.github.io"
sed -i '' '/extensions.lastAppBuildId/d;/extensions.lastAppVersion/d' "$PROFILE/prefs.js"
cd /Users/samuelesimone/Documents/Progetti/ZoteroAI && app/scripts/build_and_run -n -p LocalAIDev 2>&1 | grep LocalAI
```
(Create `$PROFILE/extensions/` first if it doesn't exist.) Expected: `[LocalAI] started 0.1.0` in the output, and no `Zotero.SDT is missing` line. Quit Zotero.

- [ ] **Step 9: Commit**

```bash
git add zotero-local-ai
git commit -m "feat(local-ai): plugin skeleton that loads in Zotero"
```

---

### Task 2: Ollama client

**Files:**
- Create: `zotero-local-ai/src/ollama.js`
- Test: `zotero-local-ai/test/ollama.test.js`
- Modify: `zotero-local-ai/bootstrap.js` (`FILES`)

**Interfaces:**
- Produces: `Ollama.OllamaClient` with `new OllamaClient({ baseURL: string, fetchImpl: Function })`, `listModels(): Promise<string[]>`, `missingModels(names: string[]): Promise<string[]>`, `embed(model: string, inputs: string[]): Promise<number[][]>`, `chat({ model, messages, onToken?(token, fullText), signal?, options? }): Promise<string>`. `Ollama.OllamaError` with `.kind` ∈ `unreachable | model-missing | forbidden | http | bad-response` and `.status`. `Ollama.readNDJSON(response)` async generator.

- [ ] **Step 1: Write the failing tests**

`zotero-local-ai/test/ollama.test.js`:
```js
const { assert } = require('chai');
const { OllamaClient, OllamaError } = require('../src/ollama.js');

function jsonResponse(obj, status = 200) {
	return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}

function streamResponse(parts) {
	let encoder = new TextEncoder();
	let stream = new ReadableStream({
		start(controller) {
			for (let part of parts) {
				controller.enqueue(encoder.encode(part));
			}
			controller.close();
		},
	});
	return new Response(stream, { status: 200 });
}

describe('OllamaClient', function () {
	it('lists model names', async function () {
		let calls = [];
		let client = new OllamaClient({
			baseURL: 'http://localhost:11434/',
			fetchImpl: async (url, init) => {
				calls.push({ url, init });
				return jsonResponse({ models: [{ name: 'gemma4:12b' }, { name: 'nomic-embed-text:latest' }] });
			},
		});
		assert.deepEqual(await client.listModels(), ['gemma4:12b', 'nomic-embed-text:latest']);
		assert.equal(calls[0].url, 'http://localhost:11434/api/tags');
		assert.equal(calls[0].init.method, 'GET');
	});

	it('reports missing models, treating a bare name as :latest', async function () {
		let client = new OllamaClient({
			baseURL: 'http://x',
			fetchImpl: async () => jsonResponse({ models: [{ name: 'nomic-embed-text:latest' }] }),
		});
		assert.deepEqual(await client.missingModels(['nomic-embed-text', 'gemma4:12b']), ['gemma4:12b']);
	});

	it('embeds a batch of inputs', async function () {
		let body;
		let client = new OllamaClient({
			baseURL: 'http://x',
			fetchImpl: async (url, init) => {
				body = JSON.parse(init.body);
				return jsonResponse({ embeddings: [[1, 0], [0, 1]] });
			},
		});
		let result = await client.embed('nomic-embed-text', ['a', 'b']);
		assert.deepEqual(result, [[1, 0], [0, 1]]);
		assert.deepEqual(body, { model: 'nomic-embed-text', input: ['a', 'b'] });
	});

	it('rejects an embed response with the wrong length', async function () {
		let client = new OllamaClient({ baseURL: 'http://x', fetchImpl: async () => jsonResponse({ embeddings: [[1]] }) });
		try {
			await client.embed('m', ['a', 'b']);
			assert.fail('should throw');
		}
		catch (e) {
			assert.instanceOf(e, OllamaError);
			assert.equal(e.kind, 'bad-response');
		}
	});

	it('streams chat tokens across chunk boundaries', async function () {
		let tokens = [];
		let client = new OllamaClient({
			baseURL: 'http://x',
			fetchImpl: async () => streamResponse([
				'{"message":{"role":"assistant","content":"Hel"},"done":false}\n{"mess',
				'age":{"role":"assistant","content":"lo"},"done":false}\n',
				'{"message":{"role":"assistant","content":""},"done":true}\n',
			]),
		});
		let full = await client.chat({
			model: 'gemma4:12b',
			messages: [{ role: 'user', content: 'hi' }],
			onToken: (token, text) => tokens.push([token, text]),
		});
		assert.equal(full, 'Hello');
		assert.deepEqual(tokens, [['Hel', 'Hel'], ['lo', 'Hello']]);
	});

	it('maps 404 to model-missing', async function () {
		let client = new OllamaClient({
			baseURL: 'http://x',
			fetchImpl: async () => jsonResponse({ error: "model 'gemma4:12b' not found" }, 404),
		});
		try {
			await client.chat({ model: 'gemma4:12b', messages: [] });
			assert.fail('should throw');
		}
		catch (e) {
			assert.equal(e.kind, 'model-missing');
			assert.equal(e.status, 404);
		}
	});

	it('maps 403 to forbidden', async function () {
		let client = new OllamaClient({ baseURL: 'http://x', fetchImpl: async () => new Response('', { status: 403 }) });
		try {
			await client.listModels();
			assert.fail('should throw');
		}
		catch (e) {
			assert.equal(e.kind, 'forbidden');
		}
	});

	it('maps network failure to unreachable', async function () {
		let client = new OllamaClient({ baseURL: 'http://x', fetchImpl: async () => { throw new TypeError('NetworkError'); } });
		try {
			await client.listModels();
			assert.fail('should throw');
		}
		catch (e) {
			assert.equal(e.kind, 'unreachable');
		}
	});
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `cd zotero-local-ai && npx mocha test/ollama.test.js`
Expected: FAIL with `Cannot find module '../src/ollama.js'`.

- [ ] **Step 3: Implement the client**

`zotero-local-ai/src/ollama.js`:
```js
var Ollama = (() => {
	class OllamaError extends Error {
		constructor(message, { status, kind } = {}) {
			super(message);
			this.name = 'OllamaError';
			this.status = status;
			this.kind = kind;
		}
	}
	
	async function* readNDJSON(response) {
		let reader = response.body.getReader();
		let decoder = new TextDecoder();
		let buffer = '';
		while (true) {
			let { value, done } = await reader.read();
			if (done) {
				break;
			}
			buffer += decoder.decode(value, { stream: true });
			let lines = buffer.split('\n');
			buffer = lines.pop();
			for (let line of lines) {
				if (line.trim()) {
					yield JSON.parse(line);
				}
			}
		}
		buffer += decoder.decode();
		if (buffer.trim()) {
			yield JSON.parse(buffer);
		}
	}
	
	function kindForStatus(status) {
		if (status === 404) {
			return 'model-missing';
		}
		if (status === 403) {
			return 'forbidden';
		}
		return 'http';
	}
	
	class OllamaClient {
		constructor({ baseURL, fetchImpl }) {
			this.baseURL = baseURL.replace(/\/+$/, '');
			this._fetch = fetchImpl;
		}
		
		async _request(path, body, { method = 'POST', signal } = {}) {
			let response;
			try {
				response = await this._fetch(this.baseURL + path, {
					method,
					headers: body ? { 'Content-Type': 'application/json' } : undefined,
					body: body ? JSON.stringify(body) : undefined,
					signal,
				});
			}
			catch (e) {
				if (e && e.name === 'AbortError') {
					throw e;
				}
				throw new OllamaError(`Cannot reach Ollama at ${this.baseURL}`, { kind: 'unreachable' });
			}
			if (!response.ok) {
				let text = '';
				try {
					text = await response.text();
				}
				catch (e) {}
				throw new OllamaError(`Ollama ${path} failed (${response.status}): ${text}`, {
					status: response.status,
					kind: kindForStatus(response.status),
				});
			}
			return response;
		}
		
		async listModels() {
			let response = await this._request('/api/tags', null, { method: 'GET' });
			let json = await response.json();
			return (json.models || []).map(m => m.name);
		}
		
		async missingModels(names) {
			let normalize = n => (n.includes(':') ? n : n + ':latest');
			let available = new Set((await this.listModels()).map(normalize));
			return names.filter(n => !available.has(normalize(n)));
		}
		
		async embed(model, inputs) {
			let response = await this._request('/api/embed', { model, input: inputs });
			let json = await response.json();
			if (!Array.isArray(json.embeddings) || json.embeddings.length !== inputs.length) {
				throw new OllamaError('Unexpected embed response from Ollama', { kind: 'bad-response' });
			}
			return json.embeddings;
		}
		
		async chat({ model, messages, onToken, signal, options }) {
			let response = await this._request('/api/chat', { model, messages, stream: true, options }, { signal });
			let full = '';
			for await (let obj of readNDJSON(response)) {
				if (obj.error) {
					throw new OllamaError(obj.error, { kind: 'http' });
				}
				let token = (obj.message && obj.message.content) || '';
				if (token) {
					full += token;
					if (onToken) {
						onToken(token, full);
					}
				}
				if (obj.done) {
					break;
				}
			}
			return full;
		}
	}
	
	return { OllamaClient, OllamaError, readNDJSON };
})();
if (typeof module === 'object') module.exports = Ollama;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd zotero-local-ai && npm test`
Expected: all passing (smoke + 8 ollama).

- [ ] **Step 5: Register the module**

In `zotero-local-ai/bootstrap.js` change the `FILES` line to:
```js
const FILES = ['config', 'ollama', 'main'];
```
Run: `npm test` → still passing (the smoke test checks the file exists).

- [ ] **Step 6: Commit**

```bash
git add zotero-local-ai
git commit -m "feat(local-ai): Ollama HTTP client with streaming chat"
```

---

### Task 3: Vector utilities

**Files:**
- Create: `zotero-local-ai/src/vectors.js`
- Test: `zotero-local-ai/test/vectors.test.js`
- Modify: `zotero-local-ai/bootstrap.js` (`FILES`)

**Interfaces:**
- Produces: `Vectors.normalize(vec: number[]|Float32Array): Float32Array` (unit length; zero vector stays zero); `Vectors.encode(vec: Float32Array): string` (base64 of little-endian float32 bytes); `Vectors.decode(str: string): Float32Array`; `Vectors.topK(query: Float32Array, items: Array<{vec: Float32Array}>, k: number): Array<{item, score}>` sorted by score desc (dot product; inputs assumed normalized); `Vectors.embedPrefixes(model: string): {document: string, query: string}`.

- [ ] **Step 1: Write the failing tests**

`zotero-local-ai/test/vectors.test.js`:
```js
const { assert } = require('chai');
const Vectors = require('../src/vectors.js');

describe('Vectors', function () {
	it('normalizes to unit length', function () {
		let v = Vectors.normalize([3, 4]);
		assert.instanceOf(v, Float32Array);
		assert.closeTo(v[0], 0.6, 1e-6);
		assert.closeTo(v[1], 0.8, 1e-6);
	});

	it('leaves a zero vector at zero', function () {
		assert.deepEqual(Array.from(Vectors.normalize([0, 0])), [0, 0]);
	});

	it('round-trips through base64', function () {
		let v = new Float32Array([0.1, -2.5, 3e-8, 1]);
		let decoded = Vectors.decode(Vectors.encode(v));
		assert.deepEqual(Array.from(decoded), Array.from(v));
	});

	it('round-trips a 768-d vector', function () {
		let v = new Float32Array(768).map((_, i) => Math.sin(i));
		assert.deepEqual(Array.from(Vectors.decode(Vectors.encode(v))), Array.from(v));
	});

	it('returns the top k by dot product', function () {
		let items = [
			{ id: 'a', vec: Vectors.normalize([1, 0]) },
			{ id: 'b', vec: Vectors.normalize([0, 1]) },
			{ id: 'c', vec: Vectors.normalize([1, 1]) },
		];
		let result = Vectors.topK(Vectors.normalize([1, 0.1]), items, 2);
		assert.deepEqual(result.map(r => r.item.id), ['a', 'c']);
		assert.isAbove(result[0].score, result[1].score);
	});

	it('handles k larger than the item count', function () {
		let items = [{ id: 'a', vec: Vectors.normalize([1, 0]) }];
		assert.lengthOf(Vectors.topK(Vectors.normalize([1, 0]), items, 5), 1);
	});

	it('uses nomic task prefixes and none for other models', function () {
		assert.deepEqual(Vectors.embedPrefixes('nomic-embed-text'), { document: 'search_document: ', query: 'search_query: ' });
		assert.deepEqual(Vectors.embedPrefixes('nomic-embed-text:latest'), { document: 'search_document: ', query: 'search_query: ' });
		assert.deepEqual(Vectors.embedPrefixes('qwen3-embedding:4b'), { document: '', query: '' });
	});
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `cd zotero-local-ai && npx mocha test/vectors.test.js`
Expected: FAIL with `Cannot find module '../src/vectors.js'`.

- [ ] **Step 3: Implement**

`zotero-local-ai/src/vectors.js`:
```js
var Vectors = (() => {
	function normalize(vec) {
		let norm = 0;
		for (let i = 0; i < vec.length; i++) {
			norm += vec[i] * vec[i];
		}
		norm = Math.sqrt(norm);
		let out = new Float32Array(vec.length);
		if (norm === 0) {
			return out;
		}
		for (let i = 0; i < vec.length; i++) {
			out[i] = vec[i] / norm;
		}
		return out;
	}
	
	// Float32Array is little-endian on all supported platforms (x86, ARM)
	function encode(vec) {
		let bytes = new Uint8Array(vec.buffer, vec.byteOffset, vec.byteLength);
		let binary = '';
		const STEP = 0x8000;
		for (let i = 0; i < bytes.length; i += STEP) {
			binary += String.fromCharCode.apply(null, bytes.subarray(i, i + STEP));
		}
		return btoa(binary);
	}
	
	function decode(str) {
		let binary = atob(str);
		let bytes = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i++) {
			bytes[i] = binary.charCodeAt(i);
		}
		return new Float32Array(bytes.buffer);
	}
	
	function dot(a, b) {
		let sum = 0;
		let n = Math.min(a.length, b.length);
		for (let i = 0; i < n; i++) {
			sum += a[i] * b[i];
		}
		return sum;
	}
	
	function topK(query, items, k) {
		let scored = items.map(item => ({ item, score: dot(query, item.vec) }));
		scored.sort((a, b) => b.score - a.score);
		return scored.slice(0, k);
	}
	
	function embedPrefixes(model) {
		if (/^nomic-embed-text/.test(model)) {
			return { document: 'search_document: ', query: 'search_query: ' };
		}
		return { document: '', query: '' };
	}
	
	return { normalize, encode, decode, topK, embedPrefixes };
})();
if (typeof module === 'object') module.exports = Vectors;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd zotero-local-ai && npm test`
Expected: all passing.

- [ ] **Step 5: Register and commit**

`bootstrap.js`: `const FILES = ['config', 'ollama', 'vectors', 'main'];`
```bash
npm test
git add zotero-local-ai
git commit -m "feat(local-ai): vector normalize/encode/topK utilities"
```

---

### Task 4: SDT structure → passages, and passages → chunks

**Files:**
- Create: `zotero-local-ai/src/sdtPassages.js`, `zotero-local-ai/src/chunker.js`
- Test: `zotero-local-ai/test/sdtPassages.test.js`, `zotero-local-ai/test/chunker.test.js`
- Modify: `zotero-local-ai/bootstrap.js` (`FILES`)

**Interfaces:**
- Consumes: SDT structure `{ catalog: { pages: [{ viewRect?, label? }] }, content: Block[] }` where a block has `type`, `content` (text nodes `{text}` or nested blocks), `anchor.pageRects: [[pageIndex, x1, y1, x2, y2], ...]`, optional `flowClass` (`'excluded'` = skip) and `reference` (bibliography entry = skip). Headings have `type: 'heading'`.
- Produces:
  - `SDTPassages.structureToPassages(structure): Passage[]` where `Passage = { text, section, pageRects: number[][], pageIndex: number|null, pageLabel: string, sortIndex: string }`.
  - `SDTPassages.makeSortIndex(pages, pageRect): string`, formatted `PPPPP|OOOOOO|TTTTT` (page index, char offset fixed at 0, top offset from page top).
  - `Chunker.chunkPassages(passages, { maxChars = 1800 } = {}): Chunk[]` where `Chunk = { ord, text, section, pageRects, pageIndex, pageLabel, sortIndex }`. Chunks never mix sections. A passage longer than `maxChars` is split at sentence boundaries and each piece keeps that passage's rects. Chunks under 30 chars are dropped.

- [ ] **Step 1: Write the failing passage tests**

`zotero-local-ai/test/sdtPassages.test.js`:
```js
const { assert } = require('chai');
const SDTPassages = require('../src/sdtPassages.js');

function para(text, pageRects, extra = {}) {
	return { type: 'paragraph', content: [{ text }], anchor: { pageRects }, ...extra };
}

describe('SDTPassages.structureToPassages', function () {
	let structure = {
		catalog: { pages: [{ viewRect: [0, 0, 612, 792], label: 'i' }, { viewRect: [0, 0, 612, 792] }] },
		content: [
			{ type: 'heading', content: [{ text: '1  Introduction' }], anchor: { pageRects: [[0, 72, 700, 300, 712]] } },
			para('We study  local\nmodels.', [[0, 72, 600, 540, 650]]),
			para('Page header', [[0, 72, 770, 540, 780]], { flowClass: 'excluded' }),
			{ type: 'heading', content: [{ text: '2 Results' }], anchor: { pageRects: [[1, 72, 700, 300, 712]] } },
			{ type: 'list', anchor: { pageRects: [[1, 72, 500, 540, 690]] }, content: [
				{ type: 'listItem', content: [para('First result.', [[1, 72, 650, 540, 690]])] },
				{ type: 'listItem', content: [para('Second result.', [[1, 72, 500, 540, 640]])] },
			] },
			para('[1] Smith 2020.', [[1, 72, 100, 540, 120]], { reference: true }),
			{ type: 'image', anchor: { pageRects: [[1, 0, 0, 10, 10]] } },
		],
	};

	it('assigns the current heading as section and collapses whitespace', function () {
		let passages = SDTPassages.structureToPassages(structure);
		assert.deepEqual(passages[0], {
			text: 'We study local models.',
			section: '1 Introduction',
			pageRects: [[0, 72, 600, 540, 650]],
			pageIndex: 0,
			pageLabel: 'i',
			sortIndex: '00000|000000|00142',
		});
	});

	it('skips excluded blocks, references, headings and empty blocks', function () {
		let texts = SDTPassages.structureToPassages(structure).map(p => p.text);
		assert.deepEqual(texts, ['We study local models.', 'First result.\nSecond result.']);
	});

	it('falls back to a 1-based page label', function () {
		let passages = SDTPassages.structureToPassages(structure);
		assert.equal(passages[1].section, '2 Results');
		assert.equal(passages[1].pageLabel, '2');
	});

	it('returns [] for an empty structure', function () {
		assert.deepEqual(SDTPassages.structureToPassages({ catalog: {}, content: [] }), []);
	});
});
```

Note: nested block text joins child blocks with `\n` (same rule as SDT's `getNestedBlockPlainText`), and whitespace collapsing only applies within inline text, so the list keeps its newline.

- [ ] **Step 2: Write the failing chunker tests**

`zotero-local-ai/test/chunker.test.js`:
```js
const { assert } = require('chai');
const Chunker = require('../src/chunker.js');

function p(text, section, page = 0) {
	return { text, section, pageRects: [[page, 0, 0, 10, 10]], pageIndex: page, pageLabel: String(page + 1), sortIndex: `0000${page}|000000|00000` };
}

describe('Chunker.chunkPassages', function () {
	it('merges consecutive passages of one section up to maxChars', function () {
		let a = 'A'.repeat(100);
		let b = 'B'.repeat(100);
		let chunks = Chunker.chunkPassages([p(a, 'Intro'), p(b, 'Intro', 1)], { maxChars: 500 });
		assert.lengthOf(chunks, 1);
		assert.equal(chunks[0].text, a + '\n' + b);
		assert.deepEqual(chunks[0].pageRects, [[0, 0, 0, 10, 10], [1, 0, 0, 10, 10]]);
		assert.equal(chunks[0].pageIndex, 0);
		assert.equal(chunks[0].pageLabel, '1');
		assert.equal(chunks[0].section, 'Intro');
		assert.equal(chunks[0].ord, 0);
	});

	it('starts a new chunk when the section changes', function () {
		let chunks = Chunker.chunkPassages([p('x'.repeat(50), 'Intro'), p('y'.repeat(50), 'Methods')]);
		assert.deepEqual(chunks.map(c => c.section), ['Intro', 'Methods']);
		assert.deepEqual(chunks.map(c => c.ord), [0, 1]);
	});

	it('starts a new chunk when maxChars would be exceeded', function () {
		let chunks = Chunker.chunkPassages([p('a'.repeat(300), 'S'), p('b'.repeat(300), 'S')], { maxChars: 500 });
		assert.lengthOf(chunks, 2);
	});

	it('splits an oversized passage at sentence boundaries', function () {
		let sentence = 'This is a sentence about results. ';
		let long = sentence.repeat(20).trim();
		let chunks = Chunker.chunkPassages([p(long, 'S')], { maxChars: 200 });
		assert.isAbove(chunks.length, 1);
		for (let c of chunks) {
			assert.isAtMost(c.text.length, 200);
			assert.match(c.text, /\.$/);
			assert.deepEqual(c.pageRects, [[0, 0, 0, 10, 10]]);
		}
	});

	it('hard-cuts a single sentence longer than maxChars', function () {
		let chunks = Chunker.chunkPassages([p('z'.repeat(450), 'S')], { maxChars: 200 });
		assert.deepEqual(chunks.map(c => c.text.length), [200, 200, 50]);
	});

	it('drops chunks shorter than 30 chars', function () {
		assert.lengthOf(Chunker.chunkPassages([p('tiny', 'S')]), 0);
	});
});
```

- [ ] **Step 3: Run them to make sure they fail**

Run: `cd zotero-local-ai && npx mocha test/sdtPassages.test.js test/chunker.test.js`
Expected: FAIL with `Cannot find module`.

- [ ] **Step 4: Implement sdtPassages.js**

`zotero-local-ai/src/sdtPassages.js`:
```js
var SDTPassages = (() => {
	const DEFAULT_VIEW_RECT = [0, 0, 612, 792];
	
	function pad(n, width) {
		return String(Math.max(0, Math.round(n))).padStart(width, '0');
	}
	
	// Mirrors getNestedBlockPlainText() in structured-document-text/src/text.js,
	// collapsing whitespace within inline runs
	function blockText(node) {
		if (node.text !== undefined) {
			return node.text;
		}
		if (!Array.isArray(node.content)) {
			return '';
		}
		let hasChildBlock = node.content.some(child => child.text === undefined);
		if (!hasChildBlock) {
			return node.content.map(child => child.text).join('').replace(/\s+/g, ' ').trim();
		}
		let parts = [];
		for (let child of node.content) {
			if (child.text !== undefined) {
				continue;
			}
			let text = blockText(child);
			if (text) {
				parts.push(text);
			}
		}
		return parts.join('\n');
	}
	
	function isValidPageRect(r) {
		return Array.isArray(r) && r.length >= 5 && r.every(Number.isFinite);
	}
	
	function makeSortIndex(pages, pageRect) {
		let [pageIndex, x1, , , y2] = pageRect;
		let viewRect = (pages[pageIndex] && pages[pageIndex].viewRect) || DEFAULT_VIEW_RECT;
		let top = viewRect[3] - y2;
		return `${pad(pageIndex, 5)}|${pad(0, 6)}|${pad(top, 5)}`;
	}
	
	function pageLabel(pages, pageIndex) {
		let page = pages[pageIndex];
		return (page && page.label) || String(pageIndex + 1);
	}
	
	function structureToPassages(structure) {
		let pages = (structure.catalog && structure.catalog.pages) || [];
		let passages = [];
		let section = '';
		for (let block of structure.content || []) {
			if (!block || block.flowClass === 'excluded') {
				continue;
			}
			let text = blockText(block);
			if (!text) {
				continue;
			}
			if (block.type === 'heading') {
				section = text;
				continue;
			}
			if (block.reference) {
				continue;
			}
			let pageRects = ((block.anchor && block.anchor.pageRects) || [])
				.filter(isValidPageRect)
				.map(r => r.slice(0, 5));
			let first = pageRects[0];
			passages.push({
				text,
				section,
				pageRects,
				pageIndex: first ? first[0] : null,
				pageLabel: first ? pageLabel(pages, first[0]) : '',
				sortIndex: first ? makeSortIndex(pages, first) : '',
			});
		}
		return passages;
	}
	
	return { structureToPassages, makeSortIndex };
})();
if (typeof module === 'object') module.exports = SDTPassages;
```

Check against the first test: page 0 viewRect top = 792, y2 = 650 → top offset 142 → `00000|000000|00142`. ✔

- [ ] **Step 5: Implement chunker.js**

`zotero-local-ai/src/chunker.js`:
```js
var Chunker = (() => {
	const MIN_CHUNK_CHARS = 30;
	
	function splitLongText(text, maxChars) {
		let sentences = text.split(/(?<=[.!?])\s+/);
		let pieces = [];
		let current = '';
		for (let sentence of sentences) {
			while (sentence.length > maxChars) {
				if (current) {
					pieces.push(current);
					current = '';
				}
				pieces.push(sentence.slice(0, maxChars));
				sentence = sentence.slice(maxChars);
			}
			if (!sentence) {
				continue;
			}
			if (current && current.length + 1 + sentence.length > maxChars) {
				pieces.push(current);
				current = sentence;
			}
			else {
				current = current ? current + ' ' + sentence : sentence;
			}
		}
		if (current) {
			pieces.push(current);
		}
		return pieces;
	}
	
	function chunkPassages(passages, { maxChars = 1800 } = {}) {
		let chunks = [];
		let current = null;
		
		function flush() {
			if (current && current.text.length >= MIN_CHUNK_CHARS) {
				current.ord = chunks.length;
				chunks.push(current);
			}
			current = null;
		}
		
		function start(passage, text) {
			current = {
				ord: 0,
				text,
				section: passage.section,
				pageRects: passage.pageRects.slice(),
				pageIndex: passage.pageIndex,
				pageLabel: passage.pageLabel,
				sortIndex: passage.sortIndex,
			};
		}
		
		for (let passage of passages) {
			if (passage.text.length > maxChars) {
				flush();
				for (let piece of splitLongText(passage.text, maxChars)) {
					start(passage, piece);
					flush();
				}
				continue;
			}
			if (current
					&& (current.section !== passage.section
						|| current.text.length + 1 + passage.text.length > maxChars)) {
				flush();
			}
			if (!current) {
				start(passage, passage.text);
			}
			else {
				current.text += '\n' + passage.text;
				current.pageRects.push(...passage.pageRects);
			}
		}
		flush();
		return chunks;
	}
	
	return { chunkPassages, splitLongText };
})();
if (typeof module === 'object') module.exports = Chunker;
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd zotero-local-ai && npm test`
Expected: all passing.

- [ ] **Step 7: Register and commit**

`bootstrap.js`: `const FILES = ['config', 'ollama', 'vectors', 'sdtPassages', 'chunker', 'main'];`
```bash
npm test
git add zotero-local-ai
git commit -m "feat(local-ai): convert SDT structure to section-aware chunks"
```

---

### Task 5: SQLite store

**Files:**
- Create: `zotero-local-ai/src/store.js`, `zotero-local-ai/test/helpers/sqljsAdapter.js`
- Test: `zotero-local-ai/test/store.test.js`
- Modify: `zotero-local-ai/bootstrap.js` (`FILES`)

**Interfaces:**
- Consumes: a db adapter with Zotero `DBConnection` semantics: `queryAsync(sql, params?) → Promise<Array<row object>>`, `valueQueryAsync(sql, params?) → Promise<any|false>`, `executeTransaction(async fn) → Promise`. `Vectors.encode/decode`.
- Produces: `new Store.Store(db)` with:
  - `init(): Promise<void>` (creates tables, idempotent)
  - `getPaper(attachmentID): Promise<{attachmentID, itemID, libraryID, hash, status, error, embedModel}|null>`
  - `setPaperStatus({attachmentID, itemID, libraryID, hash, status, error = null, embedModel = null}): Promise<void>` (upsert)
  - `replacePaperChunks({attachmentID, itemID, libraryID, hash, embedModel, chunks: Array<Chunk & {vec: Float32Array}>}): Promise<void>` (atomic; sets status `embedded`)
  - `getChunksWithEmbeddings(attachmentID): Promise<Array<{id, ord, text, section, pageIndex, pageLabel, sortIndex, pageRects, vec}>>` ordered by `ord`
  - `deletePaper(attachmentID): Promise<void>`

- [ ] **Step 1: Write the sql.js test adapter**

`zotero-local-ai/test/helpers/sqljsAdapter.js`:
```js
const initSqlJs = require('sql.js');

// Minimal stand-in for Zotero.DBConnection backed by in-memory sql.js
async function createAdapter() {
	let SQL = await initSqlJs();
	let db = new SQL.Database();
	let toParams = params => (params || []).map(v => (v === undefined ? null : v));
	return {
		async queryAsync(sql, params) {
			let stmt = db.prepare(sql);
			try {
				stmt.bind(toParams(params));
				let rows = [];
				while (stmt.step()) {
					rows.push(stmt.getAsObject());
				}
				return rows;
			}
			finally {
				stmt.free();
			}
		},
		async valueQueryAsync(sql, params) {
			let rows = await this.queryAsync(sql, params);
			if (!rows.length) {
				return false;
			}
			return Object.values(rows[0])[0];
		},
		async executeTransaction(fn) {
			db.run('BEGIN');
			try {
				let result = await fn();
				db.run('COMMIT');
				return result;
			}
			catch (e) {
				db.run('ROLLBACK');
				throw e;
			}
		},
	};
}

module.exports = { createAdapter };
```

- [ ] **Step 2: Write the failing store tests**

`zotero-local-ai/test/store.test.js`:
```js
const { assert } = require('chai');
const { createAdapter } = require('./helpers/sqljsAdapter.js');
const { Store } = require('../src/store.js');
const Vectors = require('../src/vectors.js');

function chunk(ord, text) {
	return {
		ord, text, section: 'Intro', pageIndex: 0, pageLabel: '1', sortIndex: '00000|000000|00100',
		pageRects: [[0, 1, 2, 3, 4]], vec: Vectors.normalize([ord + 1, 1]),
	};
}

describe('Store', function () {
	let store;

	beforeEach(async function () {
		store = new Store(await createAdapter());
		await store.init();
	});

	it('init is idempotent', async function () {
		await store.init();
	});

	it('returns null for an unknown paper', async function () {
		assert.isNull(await store.getPaper(42));
	});

	it('upserts paper status', async function () {
		await store.setPaperStatus({ attachmentID: 1, itemID: 10, libraryID: 1, hash: 'h1', status: 'skipped', error: 'sdt-unavailable' });
		await store.setPaperStatus({ attachmentID: 1, itemID: 10, libraryID: 1, hash: 'h2', status: 'no-text' });
		let paper = await store.getPaper(1);
		assert.equal(paper.hash, 'h2');
		assert.equal(paper.status, 'no-text');
		assert.isNull(paper.error);
	});

	it('replaces chunks atomically and reads them back with vectors', async function () {
		let args = { attachmentID: 1, itemID: 10, libraryID: 1, hash: 'h1', embedModel: 'nomic-embed-text' };
		await store.replacePaperChunks({ ...args, chunks: [chunk(0, 'first chunk'), chunk(1, 'second chunk')] });
		await store.replacePaperChunks({ ...args, hash: 'h2', chunks: [chunk(0, 'only chunk')] });
		let rows = await store.getChunksWithEmbeddings(1);
		assert.lengthOf(rows, 1);
		assert.equal(rows[0].text, 'only chunk');
		assert.deepEqual(rows[0].pageRects, [[0, 1, 2, 3, 4]]);
		assert.equal(rows[0].pageLabel, '1');
		assert.equal(rows[0].sortIndex, '00000|000000|00100');
		assert.instanceOf(rows[0].vec, Float32Array);
		assert.deepEqual(Array.from(rows[0].vec), Array.from(Vectors.normalize([1, 1])));
		let paper = await store.getPaper(1);
		assert.equal(paper.status, 'embedded');
		assert.equal(paper.hash, 'h2');
		assert.equal(paper.embedModel, 'nomic-embed-text');
	});

	it('keeps papers separate', async function () {
		let base = { itemID: 10, libraryID: 1, hash: 'h', embedModel: 'm' };
		await store.replacePaperChunks({ ...base, attachmentID: 1, chunks: [chunk(0, 'paper one')] });
		await store.replacePaperChunks({ ...base, attachmentID: 2, chunks: [chunk(0, 'paper two')] });
		assert.deepEqual((await store.getChunksWithEmbeddings(2)).map(r => r.text), ['paper two']);
	});

	it('deletes a paper and its chunks', async function () {
		await store.replacePaperChunks({ attachmentID: 1, itemID: 10, libraryID: 1, hash: 'h', embedModel: 'm', chunks: [chunk(0, 'x'.repeat(40))] });
		await store.deletePaper(1);
		assert.isNull(await store.getPaper(1));
		assert.lengthOf(await store.getChunksWithEmbeddings(1), 0);
	});
});
```

- [ ] **Step 3: Run them to make sure they fail**

Run: `cd zotero-local-ai && npx mocha test/store.test.js`
Expected: FAIL with `Cannot find module '../src/store.js'`.

- [ ] **Step 4: Implement the store**

`zotero-local-ai/src/store.js`:
```js
var Store = (() => {
	function vectorsLib() {
		return typeof Vectors !== 'undefined' ? Vectors : require('./vectors.js');
	}
	
	const SCHEMA_VERSION = 1;
	let SCHEMA = [
		`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)`,
		`CREATE TABLE IF NOT EXISTS papers (
			attachmentID INTEGER PRIMARY KEY,
			itemID INTEGER,
			libraryID INTEGER,
			hash TEXT,
			status TEXT NOT NULL,
			error TEXT,
			embedModel TEXT,
			indexedAt INTEGER
		)`,
		`CREATE TABLE IF NOT EXISTS chunks (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			attachmentID INTEGER NOT NULL,
			ord INTEGER NOT NULL,
			text TEXT NOT NULL,
			section TEXT,
			pageIndex INTEGER,
			pageLabel TEXT,
			sortIndex TEXT,
			rects TEXT NOT NULL,
			source TEXT NOT NULL DEFAULT 'sdt',
			embedding TEXT
		)`,
		`CREATE INDEX IF NOT EXISTS chunks_attachment ON chunks(attachmentID)`,
	];
	
	class Store {
		constructor(db) {
			this.db = db;
		}
		
		async init() {
			for (let sql of SCHEMA) {
				await this.db.queryAsync(sql);
			}
			await this.db.queryAsync(
				`INSERT OR REPLACE INTO meta (key, value) VALUES ('schemaVersion', ?)`,
				[String(SCHEMA_VERSION)]
			);
		}
		
		async getPaper(attachmentID) {
			let rows = await this.db.queryAsync(
				`SELECT attachmentID, itemID, libraryID, hash, status, error, embedModel
				FROM papers WHERE attachmentID = ?`,
				[attachmentID]
			);
			if (!rows.length) {
				return null;
			}
			let r = rows[0];
			return {
				attachmentID: r.attachmentID,
				itemID: r.itemID,
				libraryID: r.libraryID,
				hash: r.hash,
				status: r.status,
				error: r.error,
				embedModel: r.embedModel,
			};
		}
		
		async setPaperStatus({ attachmentID, itemID, libraryID, hash, status, error = null, embedModel = null }) {
			await this.db.queryAsync(
				`INSERT OR REPLACE INTO papers
				(attachmentID, itemID, libraryID, hash, status, error, embedModel, indexedAt)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
				[attachmentID, itemID, libraryID, hash, status, error, embedModel, Date.now()]
			);
		}
		
		async replacePaperChunks({ attachmentID, itemID, libraryID, hash, embedModel, chunks }) {
			let { encode } = vectorsLib();
			await this.db.executeTransaction(async () => {
				await this.db.queryAsync(`DELETE FROM chunks WHERE attachmentID = ?`, [attachmentID]);
				for (let c of chunks) {
					await this.db.queryAsync(
						`INSERT INTO chunks
						(attachmentID, ord, text, section, pageIndex, pageLabel, sortIndex, rects, source, embedding)
						VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'sdt', ?)`,
						[attachmentID, c.ord, c.text, c.section, c.pageIndex, c.pageLabel, c.sortIndex,
							JSON.stringify(c.pageRects), encode(c.vec)]
					);
				}
				await this.setPaperStatus({ attachmentID, itemID, libraryID, hash, status: 'embedded', embedModel });
			});
		}
		
		async getChunksWithEmbeddings(attachmentID) {
			let { decode } = vectorsLib();
			let rows = await this.db.queryAsync(
				`SELECT id, ord, text, section, pageIndex, pageLabel, sortIndex, rects, embedding
				FROM chunks WHERE attachmentID = ? AND embedding IS NOT NULL ORDER BY ord`,
				[attachmentID]
			);
			return rows.map(r => ({
				id: r.id,
				ord: r.ord,
				text: r.text,
				section: r.section,
				pageIndex: r.pageIndex,
				pageLabel: r.pageLabel,
				sortIndex: r.sortIndex,
				pageRects: JSON.parse(r.rects),
				vec: decode(r.embedding),
			}));
		}
		
		async deletePaper(attachmentID) {
			await this.db.executeTransaction(async () => {
				await this.db.queryAsync(`DELETE FROM chunks WHERE attachmentID = ?`, [attachmentID]);
				await this.db.queryAsync(`DELETE FROM papers WHERE attachmentID = ?`, [attachmentID]);
			});
		}
	}
	
	return { Store, SCHEMA_VERSION };
})();
if (typeof module === 'object') module.exports = Store;
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd zotero-local-ai && npm test`
Expected: all passing.

- [ ] **Step 6: Register and commit**

`bootstrap.js`: `const FILES = ['config', 'ollama', 'vectors', 'sdtPassages', 'chunker', 'store', 'main'];`
```bash
npm test
git add zotero-local-ai
git commit -m "feat(local-ai): SQLite store for papers and embedded chunks"
```

---

### Task 6: Paper indexing pipeline

**Files:**
- Create: `zotero-local-ai/src/paperIndex.js`
- Test: `zotero-local-ai/test/paperIndex.test.js`
- Modify: `zotero-local-ai/bootstrap.js` (`FILES`)

**Interfaces:**
- Consumes: `Chunker.chunkPassages`, `Vectors.normalize`, `Vectors.embedPrefixes`, a `Store`, an `OllamaClient`-like `{ embed(model, inputs) }`, and `getPassages(attachmentID) → Promise<{ok: true, passages} | {ok: false, reason}>`.
- Produces: `PaperIndex.ensureIndexed({ attachment: {id, itemID, libraryID, hash}, store, ollama, getPassages, embedModel, onProgress? }): Promise<{status: 'embedded', chunkCount, fromCache: boolean} | {status: 'skipped', reason} | {status: 'no-text'}>`. `onProgress` receives `{stage: 'extracting'}` and `{stage: 'embedding', done, total}`. `PaperIndex.EMBED_BATCH = 16`.

- [ ] **Step 1: Write the failing tests**

`zotero-local-ai/test/paperIndex.test.js`:
```js
const { assert } = require('chai');
const { createAdapter } = require('./helpers/sqljsAdapter.js');
const { Store } = require('../src/store.js');
const PaperIndex = require('../src/paperIndex.js');

function passage(i) {
	return { text: `Passage number ${i} with enough text to keep.`, section: `S${i}`, pageRects: [[0, 0, 0, 1, 1]], pageIndex: 0, pageLabel: '1', sortIndex: '00000|000000|00000' };
}

function fakeOllama() {
	let calls = [];
	return {
		calls,
		async embed(model, inputs) {
			calls.push({ model, inputs });
			return inputs.map((_, i) => [i + 1, 1]);
		},
	};
}

describe('PaperIndex.ensureIndexed', function () {
	let store;
	let attachment = { id: 1, itemID: 10, libraryID: 1, hash: 'h1' };

	beforeEach(async function () {
		store = new Store(await createAdapter());
		await store.init();
	});

	it('extracts, chunks, embeds with the document prefix and stores', async function () {
		let ollama = fakeOllama();
		let progress = [];
		let result = await PaperIndex.ensureIndexed({
			attachment, store, ollama, embedModel: 'nomic-embed-text',
			getPassages: async () => ({ ok: true, passages: [passage(1), passage(2)] }),
			onProgress: p => progress.push(p),
		});
		assert.deepEqual(result, { status: 'embedded', chunkCount: 2, fromCache: false });
		assert.equal(ollama.calls[0].inputs[0], 'search_document: S1\nPassage number 1 with enough text to keep.');
		assert.lengthOf(await store.getChunksWithEmbeddings(1), 2);
		assert.deepEqual(progress[0], { stage: 'extracting' });
		assert.deepEqual(progress[progress.length - 1], { stage: 'embedding', done: 2, total: 2 });
	});

	it('embeds in batches of EMBED_BATCH', async function () {
		let ollama = fakeOllama();
		let passages = Array.from({ length: PaperIndex.EMBED_BATCH + 3 }, (_, i) => passage(i));
		await PaperIndex.ensureIndexed({ attachment, store, ollama, embedModel: 'm', getPassages: async () => ({ ok: true, passages }) });
		assert.deepEqual(ollama.calls.map(c => c.inputs.length), [PaperIndex.EMBED_BATCH, 3]);
	});

	it('uses the cache when hash and model are unchanged', async function () {
		let getPassages = async () => ({ ok: true, passages: [passage(1)] });
		await PaperIndex.ensureIndexed({ attachment, store, ollama: fakeOllama(), embedModel: 'm', getPassages });
		let ollama = fakeOllama();
		let result = await PaperIndex.ensureIndexed({ attachment, store, ollama, embedModel: 'm', getPassages });
		assert.deepEqual(result, { status: 'embedded', chunkCount: 1, fromCache: true });
		assert.lengthOf(ollama.calls, 0);
	});

	it('re-indexes when the file hash changes', async function () {
		let getPassages = async () => ({ ok: true, passages: [passage(1)] });
		await PaperIndex.ensureIndexed({ attachment, store, ollama: fakeOllama(), embedModel: 'm', getPassages });
		let ollama = fakeOllama();
		await PaperIndex.ensureIndexed({ attachment: { ...attachment, hash: 'h2' }, store, ollama, embedModel: 'm', getPassages });
		assert.lengthOf(ollama.calls, 1);
	});

	it('re-indexes when the embedding model changes', async function () {
		let getPassages = async () => ({ ok: true, passages: [passage(1)] });
		await PaperIndex.ensureIndexed({ attachment, store, ollama: fakeOllama(), embedModel: 'm1', getPassages });
		let ollama = fakeOllama();
		await PaperIndex.ensureIndexed({ attachment, store, ollama, embedModel: 'm2', getPassages });
		assert.lengthOf(ollama.calls, 1);
	});

	it('records skipped when extraction fails', async function () {
		let result = await PaperIndex.ensureIndexed({
			attachment, store, ollama: fakeOllama(), embedModel: 'm',
			getPassages: async () => ({ ok: false, reason: 'sdt-unavailable' }),
		});
		assert.deepEqual(result, { status: 'skipped', reason: 'sdt-unavailable' });
		assert.equal((await store.getPaper(1)).status, 'skipped');
	});

	it('records no-text when there are no usable chunks', async function () {
		let result = await PaperIndex.ensureIndexed({
			attachment, store, ollama: fakeOllama(), embedModel: 'm',
			getPassages: async () => ({ ok: true, passages: [] }),
		});
		assert.deepEqual(result, { status: 'no-text' });
		assert.equal((await store.getPaper(1)).status, 'no-text');
	});
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `cd zotero-local-ai && npx mocha test/paperIndex.test.js`
Expected: FAIL with `Cannot find module '../src/paperIndex.js'`.

- [ ] **Step 3: Implement**

`zotero-local-ai/src/paperIndex.js`:
```js
var PaperIndex = (() => {
	function libs() {
		return {
			Chunker: typeof Chunker !== 'undefined' ? Chunker : require('./chunker.js'),
			Vectors: typeof Vectors !== 'undefined' ? Vectors : require('./vectors.js'),
		};
	}
	
	const EMBED_BATCH = 16;
	
	function embedText(prefix, chunk) {
		return prefix + (chunk.section ? chunk.section + '\n' : '') + chunk.text;
	}
	
	async function ensureIndexed({ attachment, store, ollama, getPassages, embedModel, onProgress }) {
		let { Chunker, Vectors } = libs();
		let progress = onProgress || (() => {});
		let { id, itemID, libraryID, hash } = attachment;
		
		let existing = await store.getPaper(id);
		if (existing && existing.status === 'embedded'
				&& existing.hash === hash && existing.embedModel === embedModel) {
			let chunkCount = (await store.getChunksWithEmbeddings(id)).length;
			return { status: 'embedded', chunkCount, fromCache: true };
		}
		
		progress({ stage: 'extracting' });
		let extracted = await getPassages(id);
		if (!extracted.ok) {
			await store.setPaperStatus({ attachmentID: id, itemID, libraryID, hash, status: 'skipped', error: extracted.reason });
			return { status: 'skipped', reason: extracted.reason };
		}
		
		let chunks = Chunker.chunkPassages(extracted.passages);
		if (!chunks.length) {
			await store.setPaperStatus({ attachmentID: id, itemID, libraryID, hash, status: 'no-text' });
			return { status: 'no-text' };
		}
		
		let prefix = Vectors.embedPrefixes(embedModel).document;
		for (let start = 0; start < chunks.length; start += EMBED_BATCH) {
			let batch = chunks.slice(start, start + EMBED_BATCH);
			let vectors = await ollama.embed(embedModel, batch.map(c => embedText(prefix, c)));
			batch.forEach((c, i) => {
				c.vec = Vectors.normalize(vectors[i]);
			});
			progress({ stage: 'embedding', done: start + batch.length, total: chunks.length });
		}
		
		await store.replacePaperChunks({ attachmentID: id, itemID, libraryID, hash, embedModel, chunks });
		return { status: 'embedded', chunkCount: chunks.length, fromCache: false };
	}
	
	return { ensureIndexed, EMBED_BATCH };
})();
if (typeof module === 'object') module.exports = PaperIndex;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd zotero-local-ai && npm test`
Expected: all passing.

- [ ] **Step 5: Register and commit**

`bootstrap.js`: `const FILES = ['config', 'ollama', 'vectors', 'sdtPassages', 'chunker', 'store', 'paperIndex', 'main'];`
```bash
npm test
git add zotero-local-ai
git commit -m "feat(local-ai): on-demand paper indexing pipeline"
```

---

### Task 7: Question routing, retrieval, prompt and citation parsing

**Files:**
- Create: `zotero-local-ai/src/router.js`, `zotero-local-ai/src/retriever.js`, `zotero-local-ai/src/prompt.js`
- Test: `zotero-local-ai/test/router.test.js`, `zotero-local-ai/test/retriever.test.js`, `zotero-local-ai/test/prompt.test.js`
- Modify: `zotero-local-ai/bootstrap.js` (`FILES`)

**Interfaces:**
- Consumes: `Store.getChunksWithEmbeddings`, `OllamaClient.embed`, `Vectors.normalize/topK/embedPrefixes`.
- Produces:
  - `Router.isCitationQuestion(question: string): boolean`; `Router.wantsBibTeX(question: string): boolean`.
  - `Retriever.retrieveForPaper({ question, attachmentID, store, ollama, embedModel, k = 6 }): Promise<Array<Chunk & {id, score}>>` sorted by score desc (no `vec` in output).
  - `Prompt.buildMessages({ question, sources, paperTitle, history = [] }): Array<{role, content}>` (system, the last 6 history messages, user).
  - `Prompt.parseCitations(text: string, sourceCount: number): { segments: Array<{type: 'text', text} | {type: 'cite', n}>, cited: number[] }`. `n` is 1-based; invalid numbers are removed; `cited` is unique, in first-appearance order.

- [ ] **Step 1: Write the failing tests**

`zotero-local-ai/test/router.test.js`:
```js
const { assert } = require('chai');
const Router = require('../src/router.js');

describe('Router', function () {
	for (let q of [
		'How can I cite this?',
		'give me the citation',
		'BibTeX please',
		'how do I reference this paper',
		'Come posso citare questo articolo?',
		'dammi la citazione in APA',
	]) {
		it(`detects citation intent: ${q}`, function () {
			assert.isTrue(Router.isCitationQuestion(q));
		});
	}

	for (let q of ['What are the main results?', 'Which papers are cited in the related work?', 'Summarize the method']) {
		it(`does not detect citation intent: ${q}`, function () {
			assert.isFalse(Router.isCitationQuestion(q));
		});
	}

	it('detects BibTeX requests', function () {
		assert.isTrue(Router.wantsBibTeX('bibtex entry?'));
		assert.isFalse(Router.wantsBibTeX('cite this in APA'));
	});
});
```

`zotero-local-ai/test/retriever.test.js`:
```js
const { assert } = require('chai');
const Retriever = require('../src/retriever.js');
const Vectors = require('../src/vectors.js');

describe('Retriever.retrieveForPaper', function () {
	it('embeds the question with the query prefix and ranks chunks', async function () {
		let embedded;
		let ollama = { async embed(model, inputs) { embedded = { model, inputs }; return [[1, 0]]; } };
		let store = {
			async getChunksWithEmbeddings(id) {
				assert.equal(id, 7);
				return [
					{ id: 1, ord: 0, text: 'about B', vec: Vectors.normalize([0, 1]) },
					{ id: 2, ord: 1, text: 'about A', vec: Vectors.normalize([1, 0.1]) },
					{ id: 3, ord: 2, text: 'about AB', vec: Vectors.normalize([1, 1]) },
				];
			},
		};
		let result = await Retriever.retrieveForPaper({ question: 'A?', attachmentID: 7, store, ollama, embedModel: 'nomic-embed-text', k: 2 });
		assert.deepEqual(embedded, { model: 'nomic-embed-text', inputs: ['search_query: A?'] });
		assert.deepEqual(result.map(r => r.id), [2, 3]);
		assert.notProperty(result[0], 'vec');
		assert.isNumber(result[0].score);
	});

	it('returns [] when the paper has no chunks', async function () {
		let ollama = { async embed() { return [[1, 0]]; } };
		let store = { async getChunksWithEmbeddings() { return []; } };
		assert.deepEqual(await Retriever.retrieveForPaper({ question: 'q', attachmentID: 1, store, ollama, embedModel: 'm' }), []);
	});
});
```

`zotero-local-ai/test/prompt.test.js`:
```js
const { assert } = require('chai');
const Prompt = require('../src/prompt.js');

describe('Prompt.buildMessages', function () {
	it('numbers sources with page and section', function () {
		let messages = Prompt.buildMessages({
			question: 'What are the main results?',
			paperTitle: 'Local Models',
			sources: [
				{ text: 'Accuracy is 91%.', pageLabel: '5', section: '4 Results' },
				{ text: 'We use ImageNet.', pageLabel: '3', section: '' },
			],
		});
		assert.equal(messages[0].role, 'system');
		assert.include(messages[0].content, 'square brackets');
		let user = messages[messages.length - 1];
		assert.equal(user.role, 'user');
		assert.include(user.content, 'Paper: Local Models');
		assert.include(user.content, '[1] (p. 5, 4 Results)\nAccuracy is 91%.');
		assert.include(user.content, '[2] (p. 3)\nWe use ImageNet.');
		assert.include(user.content, 'Question: What are the main results?');
	});

	it('keeps only the last 6 history messages', function () {
		let history = Array.from({ length: 10 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `m${i}` }));
		let messages = Prompt.buildMessages({ question: 'q', paperTitle: 't', sources: [], history });
		assert.lengthOf(messages, 8);
		assert.equal(messages[1].content, 'm4');
	});
});

describe('Prompt.parseCitations', function () {
	it('splits text and valid citation markers', function () {
		let { segments, cited } = Prompt.parseCitations('Accuracy is 91% [1]. Uses ImageNet [2][1].', 2);
		assert.deepEqual(segments, [
			{ type: 'text', text: 'Accuracy is 91% ' },
			{ type: 'cite', n: 1 },
			{ type: 'text', text: '. Uses ImageNet ' },
			{ type: 'cite', n: 2 },
			{ type: 'cite', n: 1 },
			{ type: 'text', text: '.' },
		]);
		assert.deepEqual(cited, [1, 2]);
	});

	it('expands comma lists and drops invalid numbers', function () {
		let { segments, cited } = Prompt.parseCitations('Claim [1, 3, 9].', 3);
		assert.deepEqual(segments, [
			{ type: 'text', text: 'Claim ' },
			{ type: 'cite', n: 1 },
			{ type: 'cite', n: 3 },
			{ type: 'text', text: '.' },
		]);
		assert.deepEqual(cited, [1, 3]);
	});

	it('removes a marker with no valid numbers', function () {
		let { segments, cited } = Prompt.parseCitations('Made up [7].', 2);
		assert.deepEqual(segments, [{ type: 'text', text: 'Made up ' }, { type: 'text', text: '.' }]);
		assert.deepEqual(cited, []);
	});

	it('returns plain text when there are no markers', function () {
		assert.deepEqual(Prompt.parseCitations('Not found in this paper.', 3).segments, [{ type: 'text', text: 'Not found in this paper.' }]);
	});
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `cd zotero-local-ai && npx mocha test/router.test.js test/retriever.test.js test/prompt.test.js`
Expected: FAIL with `Cannot find module`.

- [ ] **Step 3: Implement router.js**

`zotero-local-ai/src/router.js`:
```js
var Router = (() => {
	let CITATION_PATTERNS = [
		/\bcit(e|ing|ation)\b/i,
		/\bbibtex\b/i,
		/\bbibliograph/i,
		/\bhow (do|can|should) i reference\b/i,
		/\bcitar[ei]\b/i,
		/\bcitazione\b/i,
		/\bbibliografi/i,
	];
	
	function isCitationQuestion(question) {
		return CITATION_PATTERNS.some(re => re.test(question));
	}
	
	function wantsBibTeX(question) {
		return /\bbibtex\b/i.test(question);
	}
	
	return { isCitationQuestion, wantsBibTeX };
})();
if (typeof module === 'object') module.exports = Router;
```
Check: "Which papers are cited in the related work?" contains "cited", which matches neither `cit(e|ing|ation)\b` ("cited" ends in "ed") nor the other patterns, so it isn't treated as a citation request. ✔

- [ ] **Step 4: Implement retriever.js**

`zotero-local-ai/src/retriever.js`:
```js
var Retriever = (() => {
	function vectorsLib() {
		return typeof Vectors !== 'undefined' ? Vectors : require('./vectors.js');
	}
	
	async function retrieveForPaper({ question, attachmentID, store, ollama, embedModel, k = 6 }) {
		let V = vectorsLib();
		let chunks = await store.getChunksWithEmbeddings(attachmentID);
		if (!chunks.length) {
			return [];
		}
		let [queryVec] = await ollama.embed(embedModel, [V.embedPrefixes(embedModel).query + question]);
		return V.topK(V.normalize(queryVec), chunks, k).map(({ item, score }) => {
			let { vec, ...rest } = item;
			return { ...rest, score };
		});
	}
	
	return { retrieveForPaper };
})();
if (typeof module === 'object') module.exports = Retriever;
```

- [ ] **Step 5: Implement prompt.js**

`zotero-local-ai/src/prompt.js`:
```js
var Prompt = (() => {
	const HISTORY_LIMIT = 6;
	const SYSTEM = [
		'You are a research assistant inside Zotero. Answer the question using ONLY the numbered sources from the paper.',
		'Rules:',
		'- Cite every claim with its source number in square brackets, e.g. [2] or [1][3].',
		'- Only use source numbers that appear in the sources.',
		'- If the sources do not contain the answer, say so plainly instead of guessing.',
		'- Answer in the same language as the question. Be concise and precise.',
	].join('\n');
	
	function formatSource(source, i) {
		let where = `p. ${source.pageLabel}` + (source.section ? `, ${source.section}` : '');
		return `[${i + 1}] (${where})\n${source.text}`;
	}
	
	function buildMessages({ question, sources, paperTitle, history = [] }) {
		let context = sources.map(formatSource).join('\n\n');
		return [
			{ role: 'system', content: SYSTEM },
			...history.slice(-HISTORY_LIMIT),
			{ role: 'user', content: `Paper: ${paperTitle}\n\nSources:\n${context}\n\nQuestion: ${question}` },
		];
	}
	
	function parseCitations(text, sourceCount) {
		let segments = [];
		let cited = [];
		let re = /\[(\d+(?:\s*[,;]\s*\d+)*)\]/g;
		let last = 0;
		let match;
		while ((match = re.exec(text))) {
			if (match.index > last) {
				segments.push({ type: 'text', text: text.slice(last, match.index) });
			}
			for (let part of match[1].split(/[,;]/)) {
				let n = parseInt(part.trim(), 10);
				if (n >= 1 && n <= sourceCount) {
					segments.push({ type: 'cite', n });
					if (!cited.includes(n)) {
						cited.push(n);
					}
				}
			}
			last = re.lastIndex;
		}
		if (last < text.length) {
			segments.push({ type: 'text', text: text.slice(last) });
		}
		return { segments, cited };
	}
	
	return { buildMessages, parseCitations, SYSTEM };
})();
if (typeof module === 'object') module.exports = Prompt;
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd zotero-local-ai && npm test`
Expected: all passing.

- [ ] **Step 7: Register and commit**

`bootstrap.js`: `const FILES = ['config', 'ollama', 'vectors', 'sdtPassages', 'chunker', 'store', 'paperIndex', 'router', 'retriever', 'prompt', 'main'];`
```bash
npm test
git add zotero-local-ai
git commit -m "feat(local-ai): routing, retrieval, prompt building and citation parsing"
```

---

### Task 8: Positions and annotation JSON

**Files:**
- Create: `zotero-local-ai/src/positions.js`
- Test: `zotero-local-ai/test/positions.test.js`
- Modify: `zotero-local-ai/bootstrap.js` (`FILES`)

**Interfaces:**
- Consumes: a chunk `{ text, pageIndex, pageLabel, sortIndex, pageRects }`.
- Produces:
  - `Positions.chunkToPosition(chunk): { pageIndex, rects: number[][] }`. Rects come from the chunk's first page only, rounded to 3 decimals.
  - `Positions.annotationJSON({ chunk, key, question, color = '#ffd400' }): object`, in the shape `Zotero.Annotations.saveFromJSON` expects (`key, type: 'highlight', text, comment, color, pageLabel, sortIndex, position, tags: [{name: 'ai-cited'}]`).

- [ ] **Step 1: Write the failing tests**

`zotero-local-ai/test/positions.test.js`:
```js
const { assert } = require('chai');
const Positions = require('../src/positions.js');

let chunk = {
	text: 'Accuracy is 91%.',
	pageIndex: 4,
	pageLabel: '5',
	sortIndex: '00004|000000|00120',
	pageRects: [[4, 72.12345, 600, 540, 650], [4, 72, 500, 540, 590], [5, 72, 700, 540, 720]],
};

describe('Positions', function () {
	it('builds a reader position from rects on the first page', function () {
		assert.deepEqual(Positions.chunkToPosition(chunk), {
			pageIndex: 4,
			rects: [[72.123, 600, 540, 650], [72, 500, 540, 590]],
		});
	});

	it('builds highlight annotation JSON', function () {
		let json = Positions.annotationJSON({ chunk, key: 'ABCD2345', question: 'What is the accuracy?' });
		assert.deepEqual(json, {
			key: 'ABCD2345',
			type: 'highlight',
			text: 'Accuracy is 91%.',
			comment: 'Local AI: What is the accuracy?',
			color: '#ffd400',
			pageLabel: '5',
			sortIndex: '00004|000000|00120',
			position: { pageIndex: 4, rects: [[72.123, 600, 540, 650], [72, 500, 540, 590]] },
			tags: [{ name: 'ai-cited' }],
		});
	});
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `cd zotero-local-ai && npx mocha test/positions.test.js`
Expected: FAIL with `Cannot find module`.

- [ ] **Step 3: Implement**

`zotero-local-ai/src/positions.js`:
```js
var Positions = (() => {
	function round(n) {
		return Math.round(n * 1000) / 1000;
	}
	
	function chunkToPosition(chunk) {
		let rects = chunk.pageRects
			.filter(r => r[0] === chunk.pageIndex)
			.map(r => r.slice(1, 5).map(round));
		return { pageIndex: chunk.pageIndex, rects };
	}
	
	function annotationJSON({ chunk, key, question, color = '#ffd400' }) {
		return {
			key,
			type: 'highlight',
			text: chunk.text,
			comment: `Local AI: ${question}`,
			color,
			pageLabel: chunk.pageLabel,
			sortIndex: chunk.sortIndex,
			position: chunkToPosition(chunk),
			tags: [{ name: 'ai-cited' }],
		};
	}
	
	return { chunkToPosition, annotationJSON };
})();
if (typeof module === 'object') module.exports = Positions;
```

- [ ] **Step 4: Run tests, register, commit**

`bootstrap.js`: `const FILES = ['config', 'ollama', 'vectors', 'sdtPassages', 'chunker', 'store', 'paperIndex', 'router', 'retriever', 'prompt', 'positions', 'main'];`
```bash
cd zotero-local-ai && npm test
git add zotero-local-ai
git commit -m "feat(local-ai): reader positions and highlight annotation JSON"
```
Expected: all passing before committing.

---

### Task 9: Chat controller (orchestration and error messages)

**Files:**
- Create: `zotero-local-ai/src/chatController.js`
- Test: `zotero-local-ai/test/chatController.test.js`
- Modify: `zotero-local-ai/bootstrap.js` (`FILES`)

**Interfaces:**
- Consumes: `Router`, `PaperIndex.ensureIndexed`, `Retriever.retrieveForPaper`, `Prompt.buildMessages/parseCitations`, `Ollama.OllamaError` kinds.
- Produces: `new ChatController.ChatController({ attachment: {id, itemID, libraryID, hash}, item, paperTitle, deps: { ollama, store, getPassages, citations: { formatBibliography(item), exportBibTeX(item) }, config: { chatModel, embedModel } } })` with `ask(question, { onStatus?(text), onToken?(fullText) }): Promise<Result>`. `Result` is one of:
  - `{ kind: 'citation', style, bibliography, inText, bibtex? }`
  - `{ kind: 'answer', segments, sources, cited }`
  - `{ kind: 'error', message }`

  `history` (array of `{role, content}`) is updated only after successful answers. `ChatController.errorMessage(error, config): string` is also exported.

- [ ] **Step 1: Write the failing tests**

`zotero-local-ai/test/chatController.test.js`:
```js
const { assert } = require('chai');
const { ChatController, errorMessage } = require('../src/chatController.js');
const { OllamaError } = require('../src/ollama.js');
const { createAdapter } = require('./helpers/sqljsAdapter.js');
const { Store } = require('../src/store.js');

let config = { chatModel: 'gemma4:12b', embedModel: 'nomic-embed-text' };
let attachment = { id: 1, itemID: 10, libraryID: 1, hash: 'h' };

function passages() {
	return [
		{ text: 'The model reaches 91% accuracy on ImageNet.', section: 'Results', pageRects: [[4, 0, 0, 1, 1]], pageIndex: 4, pageLabel: '5', sortIndex: 's' },
		{ text: 'We train with a local GPU for three days.', section: 'Methods', pageRects: [[2, 0, 0, 1, 1]], pageIndex: 2, pageLabel: '3', sortIndex: 's' },
	];
}

async function makeController(overrides = {}) {
	let store = new Store(await createAdapter());
	await store.init();
	let chatCalls = [];
	let ollama = {
		async embed(model, inputs) {
			return inputs.map(t => (t.includes('accuracy') ? [1, 0] : [0, 1]));
		},
		async chat(args) {
			chatCalls.push(args);
			args.onToken('The accuracy is 91% [1]', 'The accuracy is 91% [1]');
			return 'The accuracy is 91% [1] [5].';
		},
		...overrides.ollama,
	};
	let citations = {
		formatBibliography: () => ({ style: 'APA', bibliography: 'Doe, J. (2024). Local Models.', inText: '(Doe, 2024)' }),
		exportBibTeX: async () => '@article{doe2024}',
	};
	let controller = new ChatController({
		attachment, item: { id: 10 }, paperTitle: 'Local Models',
		deps: { ollama, store, citations, config, getPassages: overrides.getPassages || (async () => ({ ok: true, passages: passages() })) },
	});
	return { controller, chatCalls };
}

describe('ChatController.ask', function () {
	it('answers citation questions from Zotero without calling the LLM', async function () {
		let { controller, chatCalls } = await makeController();
		let result = await controller.ask('How can I cite this?');
		assert.deepEqual(result, { kind: 'citation', style: 'APA', bibliography: 'Doe, J. (2024). Local Models.', inText: '(Doe, 2024)' });
		assert.lengthOf(chatCalls, 0);
	});

	it('adds BibTeX when asked', async function () {
		let { controller } = await makeController();
		let result = await controller.ask('bibtex citation please');
		assert.equal(result.bibtex, '@article{doe2024}');
	});

	it('indexes, retrieves, streams and returns validated citations', async function () {
		let { controller, chatCalls } = await makeController();
		let statuses = [];
		let streamed = [];
		let result = await controller.ask('What is the accuracy?', { onStatus: s => statuses.push(s), onToken: t => streamed.push(t) });
		assert.equal(result.kind, 'answer');
		assert.deepEqual(result.cited, [1]);
		assert.equal(result.sources[0].text, 'The model reaches 91% accuracy on ImageNet.');
		assert.notInclude(JSON.stringify(result.segments), '"n":5');
		assert.equal(chatCalls[0].model, 'gemma4:12b');
		assert.deepEqual(streamed, ['The accuracy is 91% [1]']);
		assert.include(statuses.join('|'), 'Reading the paper');
		assert.include(statuses.join('|'), 'Thinking');
		assert.deepEqual(controller.history, [
			{ role: 'user', content: 'What is the accuracy?' },
			{ role: 'assistant', content: 'The accuracy is 91% [1] [5].' },
		]);
	});

	it('reports a paper without text', async function () {
		let { controller } = await makeController({ getPassages: async () => ({ ok: true, passages: [] }) });
		let result = await controller.ask('What is this about?');
		assert.equal(result.kind, 'error');
		assert.include(result.message, 'no selectable text');
	});

	it('turns Ollama errors into actionable messages and leaves history untouched', async function () {
		let { controller } = await makeController({
			ollama: { async chat() { throw new OllamaError('nope', { kind: 'model-missing', status: 404 }); } },
		});
		let result = await controller.ask('What is the accuracy?');
		assert.deepEqual(result, { kind: 'error', message: errorMessage(new OllamaError('nope', { kind: 'model-missing' }), config) });
		assert.lengthOf(controller.history, 0);
	});
});

describe('ChatController.errorMessage', function () {
	it('explains how to fix each failure kind', function () {
		assert.include(errorMessage(new OllamaError('x', { kind: 'unreachable' }), config), 'ollama serve');
		assert.include(errorMessage(new OllamaError('x', { kind: 'model-missing' }), config), 'ollama pull gemma4:12b');
		assert.include(errorMessage(new OllamaError('x', { kind: 'model-missing' }), config), 'ollama pull nomic-embed-text');
		assert.include(errorMessage(new OllamaError('x', { kind: 'forbidden' }), config), 'OLLAMA_ORIGINS');
		assert.include(errorMessage(new Error('boom'), config), 'boom');
	});
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `cd zotero-local-ai && npx mocha test/chatController.test.js`
Expected: FAIL with `Cannot find module '../src/chatController.js'`.

- [ ] **Step 3: Implement**

`zotero-local-ai/src/chatController.js`:
```js
var ChatController = (() => {
	function libs() {
		return {
			Router: typeof Router !== 'undefined' ? Router : require('./router.js'),
			PaperIndex: typeof PaperIndex !== 'undefined' ? PaperIndex : require('./paperIndex.js'),
			Retriever: typeof Retriever !== 'undefined' ? Retriever : require('./retriever.js'),
			Prompt: typeof Prompt !== 'undefined' ? Prompt : require('./prompt.js'),
		};
	}
	
	function errorMessage(error, config) {
		switch (error && error.kind) {
			case 'unreachable':
				return 'Ollama is not running. Start it (open the Ollama app or run `ollama serve`) and try again.';
			case 'model-missing':
				return `A model is missing. Run \`ollama pull ${config.chatModel}\` and \`ollama pull ${config.embedModel}\`, then try again.`;
			case 'forbidden':
				return 'Ollama refused the request from Zotero. Run `launchctl setenv OLLAMA_ORIGINS "*"`, restart Ollama, and try again.';
			default:
				return `Something went wrong: ${error && error.message ? error.message : error}`;
		}
	}
	
	function progressText(p) {
		if (p.stage === 'extracting') {
			return 'Reading the paper…';
		}
		if (p.stage === 'embedding') {
			return `Indexing the paper (${p.done}/${p.total})…`;
		}
		return '';
	}
	
	class ChatController {
		constructor({ attachment, item, paperTitle, deps }) {
			this.attachment = attachment;
			this.item = item;
			this.paperTitle = paperTitle;
			this.deps = deps;
			this.history = [];
		}
		
		async ask(question, { onStatus, onToken } = {}) {
			let { Router, PaperIndex, Retriever, Prompt } = libs();
			let status = onStatus || (() => {});
			let { ollama, store, getPassages, citations, config } = this.deps;
			try {
				if (Router.isCitationQuestion(question)) {
					let result = { kind: 'citation', ...citations.formatBibliography(this.item) };
					if (Router.wantsBibTeX(question)) {
						result.bibtex = await citations.exportBibTeX(this.item);
					}
					return result;
				}
				
				let index = await PaperIndex.ensureIndexed({
					attachment: this.attachment,
					store,
					ollama,
					getPassages,
					embedModel: config.embedModel,
					onProgress: p => status(progressText(p)),
				});
				if (index.status === 'no-text') {
					return { kind: 'error', message: 'This PDF has no selectable text (it may be a scan). OCR support is coming in a later version.' };
				}
				if (index.status !== 'embedded') {
					return { kind: 'error', message: `This PDF could not be read (${index.reason}).` };
				}
				
				status('Searching the paper…');
				let sources = await Retriever.retrieveForPaper({
					question,
					attachmentID: this.attachment.id,
					store,
					ollama,
					embedModel: config.embedModel,
				});
				let messages = Prompt.buildMessages({ question, sources, paperTitle: this.paperTitle, history: this.history });
				status('Thinking…');
				let answer = await ollama.chat({
					model: config.chatModel,
					messages,
					onToken: (token, full) => onToken && onToken(full),
				});
				this.history.push({ role: 'user', content: question }, { role: 'assistant', content: answer });
				let { segments, cited } = Prompt.parseCitations(answer, sources.length);
				return { kind: 'answer', segments, sources, cited };
			}
			catch (e) {
				return { kind: 'error', message: errorMessage(e, config) };
			}
		}
	}
	
	return { ChatController, errorMessage };
})();
if (typeof module === 'object') module.exports = ChatController;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd zotero-local-ai && npm test`
Expected: all passing.

- [ ] **Step 5: Register and commit**

`bootstrap.js`: `const FILES = ['config', 'ollama', 'vectors', 'sdtPassages', 'chunker', 'store', 'paperIndex', 'router', 'retriever', 'prompt', 'positions', 'chatController', 'main'];`
```bash
npm test
git add zotero-local-ai
git commit -m "feat(local-ai): chat controller with citation routing and error messages"
```

---

### Task 10: Zotero adapters — extraction, citations, highlighting

**Files:**
- Create: `zotero-local-ai/src/extract.js`, `zotero-local-ai/src/citations.js`, `zotero-local-ai/src/highlight.js`
- Modify: `zotero-local-ai/bootstrap.js` (`FILES`), `zotero-local-ai/src/main.js` (expose a debug helper)

**Interfaces:**
- Consumes: `Zotero.SDT.getReader`, `SDTPassages.structureToPassages`, `Zotero.QuickCopy`, `Zotero.Styles`, `Zotero.Translate.Export`, `Zotero.Reader.open`, `Zotero.Annotations.saveFromJSON`, `Zotero.DataObjectUtilities.generateKey`, `Positions`.
- Produces:
  - `Extract.getPassages(attachmentID): Promise<{ok: true, passages} | {ok: false, reason: 'sdt-unavailable'}>`
  - `Citations.formatBibliography(item): {style, bibliography, inText}`
  - `Citations.exportBibTeX(item): Promise<string>`
  - `Highlight.showSource(attachmentID, chunk): Promise<void>`
  - `Highlight.saveAsAnnotation(attachmentID, chunk, question): Promise<Zotero.Item>`
  - `LocalAI.debugExtract(attachmentID)` returns the first 3 chunks (for manual checks)

These adapters are thin wrappers over Zotero APIs and are verified manually in the dev build: Run JavaScript, with Zotero's `Tools → Developer → Run JavaScript`.

- [ ] **Step 1: Implement the three adapters**

`zotero-local-ai/src/extract.js`:
```js
var Extract = (() => {
	async function getPassages(attachmentID) {
		let reader = await Zotero.SDT.getReader(attachmentID, { isPriority: true });
		if (!reader) {
			return { ok: false, reason: 'sdt-unavailable' };
		}
		let structure = await reader.materialize();
		return { ok: true, passages: SDTPassages.structureToPassages(structure) };
	}
	
	return { getPassages };
})();
```

`zotero-local-ai/src/citations.js`:
```js
var Citations = (() => {
	const BIBTEX_TRANSLATOR_ID = '9cb70025-a888-4a29-a210-93ec52da40d4';
	const FALLBACK_FORMAT = 'bibliography=http://www.zotero.org/styles/apa';
	
	function currentFormat() {
		let format = Zotero.QuickCopy.unserializeSetting(Zotero.Prefs.get('export.quickCopy.setting'));
		if (format.mode !== 'bibliography' || !Zotero.Styles.get(format.id)) {
			format = Zotero.QuickCopy.unserializeSetting(FALLBACK_FORMAT);
		}
		return format;
	}
	
	function formatBibliography(item) {
		let format = currentFormat();
		let style = Zotero.Styles.get(format.id);
		let bibliography = Zotero.QuickCopy.getContentFromItems([item], format, null, false);
		let inText = Zotero.QuickCopy.getContentFromItems([item], format, null, true);
		return {
			style: style ? style.title : format.id,
			bibliography: bibliography.text.trim(),
			inText: inText.text.trim(),
		};
	}
	
	function exportBibTeX(item) {
		return new Promise((resolve, reject) => {
			let translation = new Zotero.Translate.Export();
			translation.setItems([item]);
			translation.setTranslator(BIBTEX_TRANSLATOR_ID);
			translation.setHandler('done', (obj, worked) => {
				if (worked) {
					resolve(obj.string.trim());
				}
				else {
					reject(new Error('BibTeX export failed'));
				}
			});
			translation.translate();
		});
	}
	
	return { formatBibliography, exportBibTeX };
})();
```

`zotero-local-ai/src/highlight.js`:
```js
var Highlight = (() => {
	// Zotero.Reader.open() focuses an already open tab and calls navigate(); a
	// `position` location makes the PDF view scroll to it and flash it for 2 s
	async function showSource(attachmentID, chunk) {
		await Zotero.Reader.open(attachmentID, { position: Positions.chunkToPosition(chunk) });
	}
	
	async function saveAsAnnotation(attachmentID, chunk, question) {
		let attachment = Zotero.Items.get(attachmentID);
		let json = Positions.annotationJSON({
			chunk,
			key: Zotero.DataObjectUtilities.generateKey(),
			question,
		});
		return Zotero.Annotations.saveFromJSON(attachment, json);
	}
	
	return { showSource, saveAsAnnotation };
})();
```

In `zotero-local-ai/src/main.js`, add this method to the `LocalAI` object (after `log`):
```js
	async debugExtract(attachmentID) {
		let result = await Extract.getPassages(attachmentID);
		if (!result.ok) {
			return result;
		}
		return Chunker.chunkPassages(result.passages).slice(0, 3);
	},
```
and, at the start of `init()`, expose the adapters for Run JavaScript checks:
```js
		this.Highlight = Highlight;
		this.Citations = Citations;
```

`bootstrap.js`:
```js
const FILES = ['config', 'ollama', 'vectors', 'sdtPassages', 'chunker', 'store', 'paperIndex', 'router', 'retriever', 'prompt', 'positions', 'chatController', 'extract', 'citations', 'highlight', 'main'];
```

Also expose the plugin object for debugging. In `bootstrap.js` `startup`, after `LocalAI = scope.LocalAI;`, add:
```js
	Zotero.LocalAI = LocalAI;
```
and in `shutdown`, before `LocalAI = null;`, add:
```js
	delete Zotero.LocalAI;
```

- [ ] **Step 2: Run unit tests (smoke test checks FILES)**

Run: `cd zotero-local-ai && npm test`
Expected: all passing.

- [ ] **Step 3: Check extraction in the dev build**

Start Zotero (`app/scripts/build_and_run -n -p LocalAIDev`). Add a born-digital PDF paper (for example, drag in any arXiv PDF). Select its PDF attachment, open Tools → Developer → Run JavaScript, check "Run as async function", and run:
```js
let att = ZoteroPane.getSelectedItems()[0];
return JSON.stringify(await Zotero.LocalAI.debugExtract(att.id), null, 1);
```
Expected: 3 chunks with readable text, the right section names, `pageIndex` values, and `pageRects` with 5 numbers each. If `materialize()` returns an object without `content`/`catalog` at the top level, adjust `Extract.getPassages` to pass the object that does have them, and note the actual shape in a code comment.

- [ ] **Step 4: Check that SDT rects land in the right place**

In the same Run JavaScript window:
```js
let att = ZoteroPane.getSelectedItems()[0];
let chunks = await Zotero.LocalAI.debugExtract(att.id);
await Zotero.LocalAI.Highlight.showSource(att.id, chunks[1]);
```

Expected: the PDF opens on the chunk's page, and the chunk's paragraphs flash for about 2 s. If the flash appears vertically mirrored (bottom of the page instead of top), SDT uses top-left coordinates. Fix this in `Positions.chunkToPosition` by converting `y' = viewRect[3] - y` (this needs page heights: add `pageHeight` to passages in `sdtPassages.js` and carry it through the chunker) and add a unit test for the conversion. If it lands correctly, nothing changes.

- [ ] **Step 5: Check citations**

```js
let item = ZoteroPane.getSelectedItems()[0].parentItem;
let { formatBibliography, exportBibTeX } = Zotero.LocalAI.Citations;
return JSON.stringify(formatBibliography(item)) + '\n' + await exportBibTeX(item);
```

Expected: a formatted bibliography entry and in-text citation in your Quick Copy style (APA by default), followed by a `@article{...}` BibTeX entry.

- [ ] **Step 6: Commit**

```bash
git add zotero-local-ai
git commit -m "feat(local-ai): Zotero adapters for SDT extraction, citations and highlighting"
```

---

### Task 11: Reader chat panel, preferences, and wiring

**Files:**
- Create: `zotero-local-ai/src/chatPanel.js`, `zotero-local-ai/content/preferences.xhtml`, `zotero-local-ai/content/icons/ai16.svg`, `zotero-local-ai/content/icons/ai20.svg`
- Modify: `zotero-local-ai/locale/en-US/zotero-local-ai.ftl`, `zotero-local-ai/src/main.js`, `zotero-local-ai/bootstrap.js` (`FILES`)

**Interfaces:**
- Consumes: `ChatController`, `Extract.getPassages`, `Citations`, `Highlight`, `Store`, `Ollama.OllamaClient`, `Config`.
- Produces: `ChatPanel.register({ pluginID, rootURI, makeController(attachmentID): Promise<ChatController|null>, highlight }): string|false` (pane ID); `ChatPanel.unregister(paneID)`.

- [ ] **Step 1: Strings and icons**

`zotero-local-ai/locale/en-US/zotero-local-ai.ftl`:
```
local-ai-name = Local AI
local-ai-pane-header =
    .label = Local AI
local-ai-pane-sidenav =
    .tooltiptext = Local AI
```

`zotero-local-ai/content/icons/ai16.svg`:
```xml
<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><path fill="context-fill" d="M8 1l1.6 3.9L13.5 6.5 9.6 8.1 8 12 6.4 8.1 2.5 6.5l3.9-1.6zM13 11l.7 1.3L15 13l-1.3.7L13 15l-.7-1.3L11 13l1.3-.7z"/></svg>
```

`zotero-local-ai/content/icons/ai20.svg`:
```xml
<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20"><path fill="context-fill" d="M10 1.5l2 4.9 4.9 2-4.9 2L10 15.3l-2-4.9-4.9-2 4.9-2zM16.3 13.7l.9 1.7 1.7.9-1.7.9-.9 1.7-.9-1.7-1.7-.9 1.7-.9z"/></svg>
```

- [ ] **Step 2: Preferences pane**

`zotero-local-ai/content/preferences.xhtml`:
```xml
<vbox xmlns="http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul"
	xmlns:html="http://www.w3.org/1999/xhtml"
	class="main-section">
	<groupbox>
		<label><html:h2>Local AI</html:h2></label>
		<html:p>Models run locally through Ollama. Pull them first, e.g. <html:code>ollama pull gemma4:12b</html:code>.</html:p>
		<html:label for="local-ai-ollama-url">Ollama URL</html:label>
		<html:input id="local-ai-ollama-url" type="text" preference="extensions.zotero-local-ai.ollamaURL"/>
		<html:label for="local-ai-chat-model">Chat model</html:label>
		<html:input id="local-ai-chat-model" type="text" preference="extensions.zotero-local-ai.chatModel"/>
		<html:label for="local-ai-embed-model">Embedding model (changing it re-indexes papers when you next ask)</html:label>
		<html:input id="local-ai-embed-model" type="text" preference="extensions.zotero-local-ai.embedModel"/>
		<html:label for="local-ai-ocr-model">OCR model (used in a later version)</html:label>
		<html:input id="local-ai-ocr-model" type="text" preference="extensions.zotero-local-ai.ocrModel"/>
	</groupbox>
</vbox>
```

- [ ] **Step 3: Chat panel UI**

`zotero-local-ai/src/chatPanel.js`:
```js
var ChatPanel = (() => {
	const HTML_NS = 'http://www.w3.org/1999/xhtml';
	const STYLE = `
		.lai-root { display: flex; flex-direction: column; gap: 8px; padding: 4px 0; }
		.lai-messages { display: flex; flex-direction: column; gap: 8px; max-height: 60vh; overflow-y: auto; }
		.lai-msg { padding: 6px 8px; border-radius: 6px; white-space: pre-wrap; line-height: 1.4; user-select: text; }
		.lai-user { background: var(--fill-quinary); align-self: flex-end; max-width: 90%; }
		.lai-assistant { background: var(--material-sidepane); border: 1px solid var(--fill-quinary); }
		.lai-error { color: var(--accent-red); border: 1px solid var(--accent-red); }
		.lai-status { color: var(--fill-secondary); font-size: 0.9em; min-height: 1.2em; }
		.lai-cite { display: inline-block; margin: 0 1px; padding: 0 5px; border-radius: 8px; border: none; cursor: pointer;
			background: var(--accent-blue10); color: var(--accent-blue); font-size: 0.85em; }
		.lai-cite:hover { background: var(--accent-blue30); }
		.lai-sources { margin-top: 6px; display: flex; flex-direction: column; gap: 4px; font-size: 0.9em; }
		.lai-source { display: flex; gap: 6px; align-items: baseline; }
		.lai-source-text { flex: 1; color: var(--fill-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; }
		.lai-save { font-size: 0.85em; }
		.lai-code { font-family: monospace; font-size: 0.9em; padding: 6px; background: var(--fill-quinary); border-radius: 4px; white-space: pre-wrap; user-select: text; }
		.lai-input-row { display: flex; gap: 6px; }
		.lai-input { flex: 1; resize: vertical; min-height: 2.5em; font: inherit; }
	`;
	
	let _states = new WeakMap();
	
	function el(doc, tag, className, text) {
		let node = doc.createElementNS(HTML_NS, tag);
		if (className) {
			node.className = className;
		}
		if (text !== undefined) {
			node.textContent = text;
		}
		return node;
	}
	
	function currentAttachmentID(doc) {
		let win = doc.defaultView;
		let tabs = win.Zotero_Tabs;
		if (!tabs) {
			return null;
		}
		let reader = Zotero.Reader.getByTabID(tabs.selectedID);
		return reader ? reader.itemID : null;
	}
	
	function renderCitation(doc, container, result) {
		container.append(el(doc, 'div', null, `Citation (${result.style}):`));
		container.append(el(doc, 'div', 'lai-code', result.bibliography));
		container.append(el(doc, 'div', null, 'In-text:'));
		container.append(el(doc, 'div', 'lai-code', result.inText));
		if (result.bibtex) {
			container.append(el(doc, 'div', null, 'BibTeX:'));
			container.append(el(doc, 'div', 'lai-code', result.bibtex));
		}
	}
	
	function renderAnswer(doc, container, result, { attachmentID, question, highlight }) {
		container.textContent = '';
		let body = el(doc, 'div');
		for (let seg of result.segments) {
			if (seg.type === 'text') {
				body.append(doc.createTextNode(seg.text));
				continue;
			}
			let source = result.sources[seg.n - 1];
			let chip = el(doc, 'button', 'lai-cite', String(seg.n));
			chip.title = `p. ${source.pageLabel}${source.section ? ' – ' + source.section : ''}`;
			chip.addEventListener('click', () => highlight.showSource(attachmentID, source));
			body.append(chip);
		}
		container.append(body);
		
		if (!result.cited.length) {
			return;
		}
		let list = el(doc, 'div', 'lai-sources');
		for (let n of result.cited) {
			let source = result.sources[n - 1];
			let row = el(doc, 'div', 'lai-source');
			row.append(el(doc, 'span', null, `[${n}] p. ${source.pageLabel}`));
			let text = el(doc, 'span', 'lai-source-text', source.text);
			text.title = source.text;
			text.addEventListener('click', () => highlight.showSource(attachmentID, source));
			row.append(text);
			let save = el(doc, 'button', 'lai-save', 'Save');
			save.title = 'Save as a highlight annotation';
			save.addEventListener('click', async () => {
				save.disabled = true;
				try {
					await highlight.saveAsAnnotation(attachmentID, source, question);
					save.textContent = 'Saved';
				}
				catch (e) {
					Zotero.logError(e);
					save.textContent = 'Failed';
					save.disabled = false;
				}
			});
			row.append(save);
			list.append(row);
		}
		container.append(list);
	}
	
	function buildUI(doc, body) {
		body.textContent = '';
		let root = el(doc, 'div', 'lai-root');
		root.append(el(doc, 'style', null, STYLE));
		let messages = el(doc, 'div', 'lai-messages');
		let status = el(doc, 'div', 'lai-status');
		let row = el(doc, 'div', 'lai-input-row');
		let input = el(doc, 'textarea', 'lai-input');
		input.placeholder = 'Ask about this paper… (Enter to send)';
		let send = el(doc, 'button', null, 'Ask');
		row.append(input, send);
		root.append(messages, status, row);
		body.append(root);
		return { messages, status, input, send };
	}
	
	function register({ pluginID, rootURI, makeController, highlight }) {
		return Zotero.ItemPaneManager.registerSection({
			paneID: 'local-ai-chat',
			pluginID,
			header: { l10nID: 'local-ai-pane-header', icon: rootURI + 'content/icons/ai16.svg' },
			sidenav: { l10nID: 'local-ai-pane-sidenav', icon: rootURI + 'content/icons/ai20.svg' },
			onItemChange: ({ tabType, setEnabled }) => {
				setEnabled(tabType === 'reader');
			},
			onRender: ({ doc, body }) => {
				let attachmentID = currentAttachmentID(doc);
				let state = _states.get(body);
				if (state && state.attachmentID === attachmentID) {
					return;
				}
				let ui = buildUI(doc, body);
				state = { attachmentID, controller: null, busy: false, ui };
				_states.set(body, state);
				
				let ask = async () => {
					let question = ui.input.value.trim();
					if (!question || state.busy || !state.attachmentID) {
						return;
					}
					state.busy = true;
					ui.send.disabled = true;
					ui.input.value = '';
					ui.messages.append(el(doc, 'div', 'lai-msg lai-user', question));
					let answerBox = el(doc, 'div', 'lai-msg lai-assistant', '…');
					ui.messages.append(answerBox);
					ui.messages.scrollTop = ui.messages.scrollHeight;
					try {
						if (!state.controller) {
							state.controller = await makeController(state.attachmentID);
						}
						if (!state.controller) {
							answerBox.textContent = 'This item is not a PDF. Open a PDF to chat with it.';
							return;
						}
						let result = await state.controller.ask(question, {
							onStatus: text => {
								ui.status.textContent = text;
							},
							onToken: full => {
								answerBox.textContent = full;
								ui.messages.scrollTop = ui.messages.scrollHeight;
							},
						});
						if (result.kind === 'citation') {
							answerBox.textContent = '';
							renderCitation(doc, answerBox, result);
						}
						else if (result.kind === 'answer') {
							renderAnswer(doc, answerBox, result, { attachmentID: state.attachmentID, question, highlight });
						}
						else {
							answerBox.textContent = result.message;
							answerBox.classList.add('lai-error');
						}
					}
					catch (e) {
						Zotero.logError(e);
						answerBox.textContent = `Something went wrong: ${e.message}`;
						answerBox.classList.add('lai-error');
					}
					finally {
						ui.status.textContent = '';
						state.busy = false;
						ui.send.disabled = false;
						ui.messages.scrollTop = ui.messages.scrollHeight;
					}
				};
				
				ui.send.addEventListener('click', ask);
				ui.input.addEventListener('keydown', (event) => {
					if (event.key === 'Enter' && !event.shiftKey) {
						event.preventDefault();
						ask();
					}
				});
			},
		});
	}
	
	function unregister(paneID) {
		if (paneID) {
			Zotero.ItemPaneManager.unregisterSection(paneID);
		}
	}
	
	return { register, unregister };
})();
```

- [ ] **Step 4: Wire everything in main.js**

Replace `zotero-local-ai/src/main.js` with:
```js
var LocalAI = {
	id: null,
	version: null,
	rootURI: null,
	db: null,
	store: null,
	paneID: null,
	Highlight: null,
	Citations: null,
	
	log(msg) {
		Zotero.debug('[LocalAI] ' + msg);
	},
	
	async debugExtract(attachmentID) {
		let result = await Extract.getPassages(attachmentID);
		if (!result.ok) {
			return result;
		}
		return Chunker.chunkPassages(result.passages).slice(0, 3);
	},
	
	getOllama() {
		return new Ollama.OllamaClient({ baseURL: Config.get('ollamaURL'), fetchImpl: fetch });
	},
	
	async makeController(attachmentID) {
		let attachment = Zotero.Items.get(attachmentID);
		if (!attachment || !attachment.isPDFAttachment()) {
			return null;
		}
		let item = attachment.parentItem || attachment;
		return new ChatController.ChatController({
			attachment: {
				id: attachment.id,
				itemID: item.id,
				libraryID: attachment.libraryID,
				hash: await attachment.attachmentHash,
			},
			item,
			paperTitle: item.getDisplayTitle(),
			deps: {
				ollama: this.getOllama(),
				store: this.store,
				getPassages: Extract.getPassages,
				citations: Citations,
				config: { chatModel: Config.get('chatModel'), embedModel: Config.get('embedModel') },
			},
		});
	},
	
	async init({ id, version, rootURI }) {
		this.id = id;
		this.version = version;
		this.rootURI = rootURI;
		this.Highlight = Highlight;
		this.Citations = Citations;
		if (!Zotero.SDT) {
			this.log('Zotero.SDT is missing -- this Zotero build is too old for Local AI');
		}
		this.db = new Zotero.DBConnection('zotero-local-ai');
		this.store = new Store.Store(this.db);
		await this.store.init();
		Zotero.PreferencePanes.register({
			pluginID: id,
			src: rootURI + 'content/preferences.xhtml',
			label: 'Local AI',
			image: rootURI + 'content/icons/ai20.svg',
		});
		this.paneID = ChatPanel.register({
			pluginID: id,
			rootURI,
			makeController: attachmentID => this.makeController(attachmentID),
			highlight: Highlight,
		});
		this.log(`started ${version}`);
	},
	
	async shutdown() {
		ChatPanel.unregister(this.paneID);
		this.paneID = null;
		if (this.db) {
			await this.db.closeDatabase();
			this.db = null;
		}
		this.log('stopped');
	},
	
	addToWindow(win) {
		win.MozXULElement.insertFTLIfNeeded('zotero-local-ai.ftl');
	},
	
	removeFromWindow(win) {
		win.document.querySelector('[href="zotero-local-ai.ftl"]')?.remove();
	},
};
if (typeof module === 'object') module.exports = LocalAI;
```

`bootstrap.js`:
```js
const FILES = ['config', 'ollama', 'vectors', 'sdtPassages', 'chunker', 'store', 'paperIndex', 'router', 'retriever', 'prompt', 'positions', 'chatController', 'extract', 'citations', 'highlight', 'chatPanel', 'main'];
```

- [ ] **Step 5: Run unit tests**

Run: `cd zotero-local-ai && npm test`
Expected: all passing.

- [ ] **Step 6: End-to-end check in the dev build (real Ollama)**

Make sure Ollama is running (`ollama list` shows `gemma4:12b` and `nomic-embed-text`). Start Zotero with `app/scripts/build_and_run -n -p LocalAIDev`, open a born-digital PDF, and open the "Local AI" section in the right-hand pane (sparkle icon in the side nav). Check each item:

1. Ask "What are the main results?" → the status shows "Reading the paper…", then "Indexing the paper (n/n)…", then "Thinking…". The answer streams in and then shows blue `[n]` chips plus a sources list.
2. Click a chip → the PDF scrolls to that passage and flashes it.
3. Click "Save" on a source → a yellow highlight appears in the PDF and the annotations sidebar, with the comment "Local AI: What are the main results?" and the tag `ai-cited`.
4. Ask "How can I cite this?" → a formatted citation and in-text citation appear immediately, with no LLM wait.
5. Ask "Give me the BibTeX" → the BibTeX entry is shown.
6. Ask a second question → it answers without re-indexing (no "Indexing" status).
7. Quit Ollama and ask → a red message says Ollama isn't running. Restart Ollama.
8. In Settings → Local AI, set the chat model to `does-not-exist` and ask → a red message with the `ollama pull` hint appears. Restore `gemma4:12b`.
9. Open a different PDF tab → the panel shows a fresh conversation for that paper.

If any request fails with HTTP 403, run `launchctl setenv OLLAMA_ORIGINS "*"` and restart Ollama. Mention this in the README (Task 12).

- [ ] **Step 7: Commit**

```bash
git add zotero-local-ai
git commit -m "feat(local-ai): reader chat panel with clickable citations and preferences"
```

---

### Task 12: README, package build, final verification

**Files:**
- Create: `zotero-local-ai/README.md`

- [ ] **Step 1: Write the README**

`zotero-local-ai/README.md`:
````markdown
# Local AI for Zotero

Chat with the PDF you're reading using models that run on your own Mac through [Ollama](https://ollama.com). Answers cite the passages they come from; click a citation to jump to it in the PDF, or save it as a highlight. "How do I cite this?" uses Zotero's own citation styles.

Not affiliated with or endorsed by Zotero.

## Requirements

- A Zotero build that includes Structured Document Text (`Zotero.SDT`)
- Ollama with these models:

```bash
ollama pull gemma4:12b
ollama pull nomic-embed-text
```

## Install

```bash
cd zotero-local-ai
npm run build
```
Then in Zotero: Tools → Plugins → gear icon → Install Plugin From File… → `build/zotero-local-ai.xpi`.

## Use

Open a PDF and click the sparkle icon in the right-hand pane. The first question about a paper indexes it (a few seconds); later questions reuse the index, which is stored in `zotero-local-ai.sqlite` in your Zotero data directory.

Settings → Local AI lets you change the Ollama URL and the models.

## Troubleshooting

- **"Ollama is not running"** – open the Ollama app or run `ollama serve`.
- **"A model is missing"** – run the `ollama pull` commands above.
- **Ollama refused the request (403)** – run `launchctl setenv OLLAMA_ORIGINS "*"` and restart Ollama.
- **"No selectable text"** – the PDF is a scan; OCR arrives in a later version.

## Development

```bash
npm install
npm test
```
Load the plugin into a dev profile by putting the absolute path of this folder into `<profile>/extensions/local-ai@samuelesimone.github.io`.
````

- [ ] **Step 2: Build the xpi and install it like a user**

```bash
cd zotero-local-ai && npm test && npm run build && unzip -l build/zotero-local-ai.xpi | head -30
```
Expected: tests pass, and the archive lists `manifest.json`, `bootstrap.js`, `prefs.js`, `src/*.js`, `content/...`, and `locale/en-US/zotero-local-ai.ftl` at the top level (not nested in a folder).

Remove the proxy file from the dev profile, start Zotero, install `build/zotero-local-ai.xpi` via Tools → Plugins → Install Plugin From File, and repeat checks 1–4 from Task 11 Step 6.
Expected: same behavior as the proxy-loaded plugin. Restore the proxy file afterwards for development.

- [ ] **Step 3: Commit and push**

```bash
git add zotero-local-ai/README.md
git commit -m "docs(local-ai): README with setup and troubleshooting"
git push
```
