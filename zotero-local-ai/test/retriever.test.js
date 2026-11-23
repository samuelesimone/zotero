const { assert } = require('chai');
const Retriever = require('../src/retriever.js');
const Vectors = require('../src/vectors.js');

describe('Retriever.retrieveForPaper', function () {
	it('embeds the question with the query prefix and ranks chunks', async function () {
		let embedded;
		let ollama = { async embed(model, inputs) { embedded = { model, inputs }; return [[1, 0]]; } };
		let store = {
			async getChunksWithEmbeddings(id) {
				assert.equal(id, 7);
				return [
					{ id: 1, ord: 0, text: 'about B', vec: Vectors.normalize([0, 1]) },
					{ id: 2, ord: 1, text: 'about A', vec: Vectors.normalize([1, 0.1]) },
					{ id: 3, ord: 2, text: 'about AB', vec: Vectors.normalize([1, 1]) },
				];
			},
		};
		let result = await Retriever.retrieveForPaper({ question: 'A?', attachmentID: 7, store, ollama, embedModel: 'nomic-embed-text', k: 2 });
		assert.deepEqual(embedded, { model: 'nomic-embed-text', inputs: ['search_query: A?'] });
		assert.deepEqual(result.map(r => r.id), [2, 3]);
		assert.notProperty(result[0], 'vec');
		assert.isNumber(result[0].score);
	});

	it('returns [] when the paper has no chunks', async function () {
		let ollama = { async embed() { return [[1, 0]]; } };
		let store = { async getChunksWithEmbeddings() { return []; } };
		assert.deepEqual(await Retriever.retrieveForPaper({ question: 'q', attachmentID: 1, store, ollama, embedModel: 'm' }), []);
	});
});
