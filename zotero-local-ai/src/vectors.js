var Vectors = (() => {
	function normalize(vec) {
		let norm = 0;
		for (let i = 0; i < vec.length; i++) {
			norm += vec[i] * vec[i];
		}
		norm = Math.sqrt(norm);
		let out = new Float32Array(vec.length);
		if (norm === 0) {
			return out;
		}
		for (let i = 0; i < vec.length; i++) {
			out[i] = vec[i] / norm;
		}
		return out;
	}

	// Float32Array is little-endian on all supported platforms (x86, ARM)
	function encode(vec) {
		let bytes = new Uint8Array(vec.buffer, vec.byteOffset, vec.byteLength);
		let binary = '';
		const STEP = 0x8000;
		for (let i = 0; i < bytes.length; i += STEP) {
			binary += String.fromCharCode.apply(null, bytes.subarray(i, i + STEP));
		}
		return btoa(binary);
	}

	function decode(str) {
		let binary = atob(str);
		let bytes = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i++) {
			bytes[i] = binary.charCodeAt(i);
		}
		return new Float32Array(bytes.buffer);
	}

	function dot(a, b) {
		let sum = 0;
		let n = Math.min(a.length, b.length);
		for (let i = 0; i < n; i++) {
			sum += a[i] * b[i];
		}
		return sum;
	}

	function topK(query, items, k) {
		let scored = items.map(item => ({ item, score: dot(query, item.vec) }));
		scored.sort((a, b) => b.score - a.score);
		return scored.slice(0, k);
	}

	function embedPrefixes(model) {
		if (/^nomic-embed-text/.test(model)) {
			return { document: 'search_document: ', query: 'search_query: ' };
		}
		return { document: '', query: '' };
	}

	return { normalize, encode, decode, topK, embedPrefixes };
})();
if (typeof module === 'object') module.exports = Vectors;
