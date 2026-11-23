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
