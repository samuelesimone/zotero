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
	
	async function formatBibliography(item) {
		// Styles load lazily; init() is idempotent and returns the pending load
		await Zotero.Styles.init();
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
					// Drop the local file path line that Zotero's BibTeX export adds
					resolve(obj.string.split('\n').filter(line => !/^\s*file\s*=/.test(line)).join('\n').trim());
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
