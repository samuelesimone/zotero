/* global Zotero, Services, Cu, ChromeUtils */
var LocalAI;

const FILES = ['config', 'ollama', 'vectors', 'sdtPassages', 'chunker', 'store', 'paperIndex', 'router', 'retriever', 'prompt', 'positions', 'chatController', 'extract', 'citations', 'highlight', 'chatPanel', 'main'];

function install() {}

async function startup({ id, version, rootURI }) {
	await Zotero.initializationPromise;
	Cu.importGlobalProperties(['fetch', 'atob', 'btoa', 'TextDecoder', 'TextEncoder']);
	let scope = { Zotero, Services, Cu, ChromeUtils, fetch, atob, btoa, TextDecoder, TextEncoder };
	for (let name of FILES) {
		Services.scriptloader.loadSubScript(rootURI + 'src/' + name + '.js', scope);
	}
	LocalAI = scope.LocalAI;
	Zotero.LocalAI = LocalAI;
	await LocalAI.init({ id, version, rootURI });
	for (let win of Zotero.getMainWindows()) {
		LocalAI.addToWindow(win);
	}

	// Dev-only self-check (dev/ is not packaged in the xpi)
	let devcheckPDF = Zotero.Prefs.get('extensions.zotero-local-ai.devcheck', true);
	if (devcheckPDF) {
		Services.scriptloader.loadSubScript(rootURI + 'dev/devcheck.js', scope);
		let ask = Zotero.Prefs.get('extensions.zotero-local-ai.devcheckAsk', true) || null;
		Zotero.uiReadyPromise.then(() => scope.DevCheck.run(devcheckPDF, { ask }));
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
	delete Zotero.LocalAI;
	LocalAI = null;
}

function uninstall() {}
