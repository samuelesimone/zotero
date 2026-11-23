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
