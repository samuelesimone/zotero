# Local AI for Zotero

Chat with the PDF you're reading using models that run on your own Mac through [Ollama](https://ollama.com). Answers cite the passages they come from; click a citation to jump to it in the PDF, or save it as a highlight. "How do I cite this?" uses Zotero's own citation styles.

Not affiliated with or endorsed by Zotero.

## Requirements

- A Zotero build that includes Structured Document Text (`Zotero.SDT`), currently a build from Zotero's main branch
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

- Click a blue `[n]` chip or a source line to jump to that passage (it flashes for 2 seconds).
- Click **Save** next to a source to keep it as a yellow highlight tagged `ai-cited`.
- Ask "How can I cite this?" or "BibTeX please" for a citation in your Quick Copy style.

Settings → Local AI lets you change the Ollama URL and the models.

## Troubleshooting

- **"Ollama is not running"**: open the Ollama app or run `ollama serve`.
- **"A model is missing"**: run the `ollama pull` commands above.
- **Ollama refused the request (403)**: run `launchctl setenv OLLAMA_ORIGINS "*"` and restart Ollama.
- **"No selectable text"**: the PDF is a scan; OCR arrives in a later version.
- **Slow first answer**: Ollama loads the chat model into memory on first use (about 30–60 s for `gemma4:12b`).

## Development

```bash
npm install
npm test
```

Run against a Zotero built from this repo with a dedicated profile:

```bash
# from the repo root, once
app/scripts/fetch_xulrunner -p m
npm install && NODE_OPTIONS=--openssl-legacy-provider node js-build/build.js && app/scripts/dir_build
app/staging/Zotero.app/Contents/MacOS/zotero -CreateProfile LocalAIDev

# load the plugin from source
PROFILE=$(ls -d ~/Library/Application\ Support/Zotero/Profiles/*.LocalAIDev)
mkdir -p "$PROFILE/extensions"
echo "$PWD/zotero-local-ai/" > "$PROFILE/extensions/local-ai@samuelesimone.github.io"
echo 'user_pref("extensions.autoDisableScopes", 0);' >> "$PROFILE/user.js"

app/staging/Zotero.app/Contents/MacOS/zotero -P LocalAIDev -ZoteroDebugText -purgecaches
```

`extensions.autoDisableScopes = 0` is needed because Zotero otherwise disables plugins placed in the profile folder.

### Dev self-check

`dev/devcheck.js` (not packaged) runs at startup when these prefs are set in the dev profile's `user.js`:

```js
user_pref("extensions.zotero-local-ai.devcheck", "/absolute/path/to/a/paper.pdf");
user_pref("extensions.zotero-local-ai.devcheckAsk", "What are the main results?"); // optional, uses Ollama
```

It imports the PDF (once), logs extraction, citation and BibTeX output and, with `devcheckAsk`, the answer, reader navigation and annotation saving, all prefixed `[LocalAI][devcheck]` in the debug output.
