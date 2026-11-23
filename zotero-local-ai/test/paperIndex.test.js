const { assert } = require('chai');
const { createAdapter } = require('./helpers/sqljsAdapter.js');
const { Store } = require('../src/store.js');
const PaperIndex = require('../src/paperIndex.js');

function passage(i) {
	return { text: `Passage number ${i} with enough text to keep.`, section: `S${i}`, pageRects: [[0, 0, 0, 1, 1]], pageIndex: 0, pageLabel: '1', sortIndex: '00000|000000|00000' };
}

function fakeOllama() {
	let calls = [];
	return {
		calls,
		async embed(model, inputs) {
			calls.push({ model, inputs });
			return inputs.map((_, i) => [i + 1, 1]);
		},
	};
}

describe('PaperIndex.ensureIndexed', function () {
	let store;
	let attachment = { id: 1, itemID: 10, libraryID: 1, hash: 'h1' };

	beforeEach(async function () {
		store = new Store(await createAdapter());
		await store.init();
	});

	it('extracts, chunks, embeds with the document prefix and stores', async function () {
		let ollama = fakeOllama();
		let progress = [];
		let result = await PaperIndex.ensureIndexed({
			attachment, store, ollama, embedModel: 'nomic-embed-text',
			getPassages: async () => ({ ok: true, passages: [passage(1), passage(2)] }),
			onProgress: p => progress.push(p),
		});
		assert.deepEqual(result, { status: 'embedded', chunkCount: 2, fromCache: false });
		assert.equal(ollama.calls[0].inputs[0], 'search_document: S1\nPassage number 1 with enough text to keep.');
		assert.lengthOf(await store.getChunksWithEmbeddings(1), 2);
		assert.deepEqual(progress[0], { stage: 'extracting' });
		assert.deepEqual(progress[progress.length - 1], { stage: 'embedding', done: 2, total: 2 });
	});

	it('embeds in batches of EMBED_BATCH', async function () {
		let ollama = fakeOllama();
		let passages = Array.from({ length: PaperIndex.EMBED_BATCH + 3 }, (_, i) => passage(i));
		await PaperIndex.ensureIndexed({ attachment, store, ollama, embedModel: 'm', getPassages: async () => ({ ok: true, passages }) });
		assert.deepEqual(ollama.calls.map(c => c.inputs.length), [PaperIndex.EMBED_BATCH, 3]);
	});

	it('uses the cache when hash and model are unchanged', async function () {
		let getPassages = async () => ({ ok: true, passages: [passage(1)] });
		await PaperIndex.ensureIndexed({ attachment, store, ollama: fakeOllama(), embedModel: 'm', getPassages });
		let ollama = fakeOllama();
		let result = await PaperIndex.ensureIndexed({ attachment, store, ollama, embedModel: 'm', getPassages });
		assert.deepEqual(result, { status: 'embedded', chunkCount: 1, fromCache: true });
		assert.lengthOf(ollama.calls, 0);
	});

	it('re-indexes when the file hash changes', async function () {
		let getPassages = async () => ({ ok: true, passages: [passage(1)] });
		await PaperIndex.ensureIndexed({ attachment, store, ollama: fakeOllama(), embedModel: 'm', getPassages });
		let ollama = fakeOllama();
		await PaperIndex.ensureIndexed({ attachment: { ...attachment, hash: 'h2' }, store, ollama, embedModel: 'm', getPassages });
		assert.lengthOf(ollama.calls, 1);
	});

	it('re-indexes when the embedding model changes', async function () {
		let getPassages = async () => ({ ok: true, passages: [passage(1)] });
		await PaperIndex.ensureIndexed({ attachment, store, ollama: fakeOllama(), embedModel: 'm1', getPassages });
		let ollama = fakeOllama();
		await PaperIndex.ensureIndexed({ attachment, store, ollama, embedModel: 'm2', getPassages });
		assert.lengthOf(ollama.calls, 1);
	});

	it('records skipped when extraction fails', async function () {
		let result = await PaperIndex.ensureIndexed({
			attachment, store, ollama: fakeOllama(), embedModel: 'm',
			getPassages: async () => ({ ok: false, reason: 'sdt-unavailable' }),
		});
		assert.deepEqual(result, { status: 'skipped', reason: 'sdt-unavailable' });
		assert.equal((await store.getPaper(1)).status, 'skipped');
	});

	it('records no-text when there are no usable chunks', async function () {
		let result = await PaperIndex.ensureIndexed({
			attachment, store, ollama: fakeOllama(), embedModel: 'm',
			getPassages: async () => ({ ok: true, passages: [] }),
		});
		assert.deepEqual(result, { status: 'no-text' });
		assert.equal((await store.getPaper(1)).status, 'no-text');
	});
});
