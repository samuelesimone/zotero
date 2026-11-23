const { assert } = require('chai');
const { createAdapter } = require('./helpers/sqljsAdapter.js');
const { Store } = require('../src/store.js');
const Vectors = require('../src/vectors.js');

function chunk(ord, text) {
	return {
		ord, text, section: 'Intro', pageIndex: 0, pageLabel: '1', sortIndex: '00000|000000|00100',
		pageRects: [[0, 1, 2, 3, 4]], vec: Vectors.normalize([ord + 1, 1]),
	};
}

describe('Store', function () {
	let store;

	beforeEach(async function () {
		store = new Store(await createAdapter());
		await store.init();
	});

	it('init is idempotent', async function () {
		await store.init();
	});

	it('returns null for an unknown paper', async function () {
		assert.isNull(await store.getPaper(42));
	});

	it('upserts paper status', async function () {
		await store.setPaperStatus({ attachmentID: 1, itemID: 10, libraryID: 1, hash: 'h1', status: 'skipped', error: 'sdt-unavailable' });
		await store.setPaperStatus({ attachmentID: 1, itemID: 10, libraryID: 1, hash: 'h2', status: 'no-text' });
		let paper = await store.getPaper(1);
		assert.equal(paper.hash, 'h2');
		assert.equal(paper.status, 'no-text');
		assert.isNull(paper.error);
	});

	it('replaces chunks atomically and reads them back with vectors', async function () {
		let args = { attachmentID: 1, itemID: 10, libraryID: 1, hash: 'h1', embedModel: 'nomic-embed-text' };
		await store.replacePaperChunks({ ...args, chunks: [chunk(0, 'first chunk'), chunk(1, 'second chunk')] });
		await store.replacePaperChunks({ ...args, hash: 'h2', chunks: [chunk(0, 'only chunk')] });
		let rows = await store.getChunksWithEmbeddings(1);
		assert.lengthOf(rows, 1);
		assert.equal(rows[0].text, 'only chunk');
		assert.deepEqual(rows[0].pageRects, [[0, 1, 2, 3, 4]]);
		assert.equal(rows[0].pageLabel, '1');
		assert.equal(rows[0].sortIndex, '00000|000000|00100');
		assert.instanceOf(rows[0].vec, Float32Array);
		assert.deepEqual(Array.from(rows[0].vec), Array.from(Vectors.normalize([1, 1])));
		let paper = await store.getPaper(1);
		assert.equal(paper.status, 'embedded');
		assert.equal(paper.hash, 'h2');
		assert.equal(paper.embedModel, 'nomic-embed-text');
	});

	it('keeps papers separate', async function () {
		let base = { itemID: 10, libraryID: 1, hash: 'h', embedModel: 'm' };
		await store.replacePaperChunks({ ...base, attachmentID: 1, chunks: [chunk(0, 'paper one')] });
		await store.replacePaperChunks({ ...base, attachmentID: 2, chunks: [chunk(0, 'paper two')] });
		assert.deepEqual((await store.getChunksWithEmbeddings(2)).map(r => r.text), ['paper two']);
	});

	it('deletes a paper and its chunks', async function () {
		await store.replacePaperChunks({ attachmentID: 1, itemID: 10, libraryID: 1, hash: 'h', embedModel: 'm', chunks: [chunk(0, 'x'.repeat(40))] });
		await store.deletePaper(1);
		assert.isNull(await store.getPaper(1));
		assert.lengthOf(await store.getChunksWithEmbeddings(1), 0);
	});
});
