var LocalAI = {
	id: null,
	version: null,
	rootURI: null,
	
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
	
	async init({ id, version, rootURI }) {
		this.id = id;
		this.version = version;
		this.rootURI = rootURI;
		this.Highlight = Highlight;
		this.Citations = Citations;
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
