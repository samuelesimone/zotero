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
