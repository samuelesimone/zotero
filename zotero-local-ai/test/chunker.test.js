const { assert } = require('chai');
const Chunker = require('../src/chunker.js');

function p(text, section, page = 0) {
	return { text, section, pageRects: [[page, 0, 0, 10, 10]], pageIndex: page, pageLabel: String(page + 1), sortIndex: `0000${page}|000000|00000` };
}

describe('Chunker.chunkPassages', function () {
	it('merges consecutive passages of one section up to maxChars', function () {
		let a = 'A'.repeat(100);
		let b = 'B'.repeat(100);
		let chunks = Chunker.chunkPassages([p(a, 'Intro'), p(b, 'Intro', 1)], { maxChars: 500 });
		assert.lengthOf(chunks, 1);
		assert.equal(chunks[0].text, a + '\n' + b);
		assert.deepEqual(chunks[0].pageRects, [[0, 0, 0, 10, 10], [1, 0, 0, 10, 10]]);
		assert.equal(chunks[0].pageIndex, 0);
		assert.equal(chunks[0].pageLabel, '1');
		assert.equal(chunks[0].section, 'Intro');
		assert.equal(chunks[0].ord, 0);
	});

	it('starts a new chunk when the section changes', function () {
		let chunks = Chunker.chunkPassages([p('x'.repeat(50), 'Intro'), p('y'.repeat(50), 'Methods')]);
		assert.deepEqual(chunks.map(c => c.section), ['Intro', 'Methods']);
		assert.deepEqual(chunks.map(c => c.ord), [0, 1]);
	});

	it('starts a new chunk when maxChars would be exceeded', function () {
		let chunks = Chunker.chunkPassages([p('a'.repeat(300), 'S'), p('b'.repeat(300), 'S')], { maxChars: 500 });
		assert.lengthOf(chunks, 2);
	});

	it('splits an oversized passage at sentence boundaries', function () {
		let sentence = 'This is a sentence about results. ';
		let long = sentence.repeat(20).trim();
		let chunks = Chunker.chunkPassages([p(long, 'S')], { maxChars: 200 });
		assert.isAbove(chunks.length, 1);
		for (let c of chunks) {
			assert.isAtMost(c.text.length, 200);
			assert.match(c.text, /\.$/);
			assert.deepEqual(c.pageRects, [[0, 0, 0, 10, 10]]);
		}
	});

	it('hard-cuts a single sentence longer than maxChars', function () {
		let chunks = Chunker.chunkPassages([p('z'.repeat(450), 'S')], { maxChars: 200 });
		assert.deepEqual(chunks.map(c => c.text.length), [200, 200, 50]);
	});

	it('drops chunks shorter than 30 chars', function () {
		assert.lengthOf(Chunker.chunkPassages([p('tiny', 'S')]), 0);
	});
});
