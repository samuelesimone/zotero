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
