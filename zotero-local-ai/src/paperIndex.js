var PaperIndex = (() => {
	function libs() {
		return {
			Chunker: typeof Chunker !== 'undefined' ? Chunker : require('./chunker.js'),
			Vectors: typeof Vectors !== 'undefined' ? Vectors : require('./vectors.js'),
		};
	}

	const EMBED_BATCH = 16;

	function embedText(prefix, chunk) {
		return prefix + (chunk.section ? chunk.section + '\n' : '') + chunk.text;
	}

	async function ensureIndexed({ attachment, store, ollama, getPassages, embedModel, onProgress }) {
		let { Chunker, Vectors } = libs();
		let progress = onProgress || (() => {});
		let { id, itemID, libraryID, hash } = attachment;

		let existing = await store.getPaper(id);
		if (existing && existing.status === 'embedded'
				&& existing.hash === hash && existing.embedModel === embedModel) {
			let chunkCount = (await store.getChunksWithEmbeddings(id)).length;
			return { status: 'embedded', chunkCount, fromCache: true };
		}

		progress({ stage: 'extracting' });
		let extracted = await getPassages(id);
		if (!extracted.ok) {
			await store.setPaperStatus({ attachmentID: id, itemID, libraryID, hash, status: 'skipped', error: extracted.reason });
			return { status: 'skipped', reason: extracted.reason };
		}

		let chunks = Chunker.chunkPassages(extracted.passages);
		if (!chunks.length) {
			await store.setPaperStatus({ attachmentID: id, itemID, libraryID, hash, status: 'no-text' });
			return { status: 'no-text' };
		}

		let prefix = Vectors.embedPrefixes(embedModel).document;
		for (let start = 0; start < chunks.length; start += EMBED_BATCH) {
			let batch = chunks.slice(start, start + EMBED_BATCH);
			let vectors = await ollama.embed(embedModel, batch.map(c => embedText(prefix, c)));
			batch.forEach((c, i) => {
				c.vec = Vectors.normalize(vectors[i]);
			});
			progress({ stage: 'embedding', done: start + batch.length, total: chunks.length });
		}

		await store.replacePaperChunks({ attachmentID: id, itemID, libraryID, hash, embedModel, chunks });
		return { status: 'embedded', chunkCount: chunks.length, fromCache: false };
	}

	return { ensureIndexed, EMBED_BATCH };
})();
if (typeof module === 'object') module.exports = PaperIndex;
