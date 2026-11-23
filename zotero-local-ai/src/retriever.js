var Retriever = (() => {
	function vectorsLib() {
		return typeof Vectors !== 'undefined' ? Vectors : require('./vectors.js');
	}
	
	async function retrieveForPaper({ question, attachmentID, store, ollama, embedModel, k = 6 }) {
		let V = vectorsLib();
		let chunks = await store.getChunksWithEmbeddings(attachmentID);
		if (!chunks.length) {
			return [];
		}
		let [queryVec] = await ollama.embed(embedModel, [V.embedPrefixes(embedModel).query + question]);
		return V.topK(V.normalize(queryVec), chunks, k).map(({ item, score }) => {
			let { vec, ...rest } = item;
			return { ...rest, score };
		});
	}
	
	return { retrieveForPaper };
})();
if (typeof module === 'object') module.exports = Retriever;
