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
