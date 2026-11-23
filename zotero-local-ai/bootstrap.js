/* global Zotero, Services, Cu, ChromeUtils */
var LocalAI;

const FILES = ['config', 'ollama', 'vectors', 'sdtPassages', 'chunker', 'store', 'paperIndex', 'router', 'retriever', 'prompt', 'main'];

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
