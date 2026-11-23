const { assert } = require('chai');
const Vectors = require('../src/vectors.js');

describe('Vectors', function () {
	it('normalizes to unit length', function () {
		let v = Vectors.normalize([3, 4]);
		assert.instanceOf(v, Float32Array);
		assert.closeTo(v[0], 0.6, 1e-6);
		assert.closeTo(v[1], 0.8, 1e-6);
	});

	it('leaves a zero vector at zero', function () {
		assert.deepEqual(Array.from(Vectors.normalize([0, 0])), [0, 0]);
	});

	it('round-trips through base64', function () {
		let v = new Float32Array([0.1, -2.5, 3e-8, 1]);
		let decoded = Vectors.decode(Vectors.encode(v));
		assert.deepEqual(Array.from(decoded), Array.from(v));
	});

	it('round-trips a 768-d vector', function () {
		let v = new Float32Array(768).map((_, i) => Math.sin(i));
		assert.deepEqual(Array.from(Vectors.decode(Vectors.encode(v))), Array.from(v));
	});

	it('returns the top k by dot product', function () {
		let items = [
			{ id: 'a', vec: Vectors.normalize([1, 0]) },
			{ id: 'b', vec: Vectors.normalize([0, 1]) },
			{ id: 'c', vec: Vectors.normalize([1, 1]) },
		];
		let result = Vectors.topK(Vectors.normalize([1, 0.1]), items, 2);
		assert.deepEqual(result.map(r => r.item.id), ['a', 'c']);
		assert.isAbove(result[0].score, result[1].score);
	});

	it('handles k larger than the item count', function () {
		let items = [{ id: 'a', vec: Vectors.normalize([1, 0]) }];
		assert.lengthOf(Vectors.topK(Vectors.normalize([1, 0]), items, 5), 1);
	});

	it('uses nomic task prefixes and none for other models', function () {
		assert.deepEqual(Vectors.embedPrefixes('nomic-embed-text'), { document: 'search_document: ', query: 'search_query: ' });
		assert.deepEqual(Vectors.embedPrefixes('nomic-embed-text:latest'), { document: 'search_document: ', query: 'search_query: ' });
		assert.deepEqual(Vectors.embedPrefixes('qwen3-embedding:4b'), { document: '', query: '' });
	});
});
