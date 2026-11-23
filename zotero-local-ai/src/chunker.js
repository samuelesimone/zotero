var Chunker = (() => {
	const MIN_CHUNK_CHARS = 30;

	function splitLongText(text, maxChars) {
		let sentences = text.split(/(?<=[.!?])\s+/);
		let pieces = [];
		let current = '';
		for (let sentence of sentences) {
			while (sentence.length > maxChars) {
				if (current) {
					pieces.push(current);
					current = '';
				}
				pieces.push(sentence.slice(0, maxChars));
				sentence = sentence.slice(maxChars);
			}
			if (!sentence) {
				continue;
			}
			if (current && current.length + 1 + sentence.length > maxChars) {
				pieces.push(current);
				current = sentence;
			}
			else {
				current = current ? current + ' ' + sentence : sentence;
			}
		}
		if (current) {
			pieces.push(current);
		}
		return pieces;
	}

	function chunkPassages(passages, { maxChars = 1800 } = {}) {
		let chunks = [];
		let current = null;

		function flush() {
			if (current && current.text.length >= MIN_CHUNK_CHARS) {
				current.ord = chunks.length;
				chunks.push(current);
			}
			current = null;
		}

		function start(passage, text) {
			current = {
				ord: 0,
				text,
				section: passage.section,
				pageRects: passage.pageRects.slice(),
				pageIndex: passage.pageIndex,
				pageLabel: passage.pageLabel,
				sortIndex: passage.sortIndex,
			};
		}

		for (let passage of passages) {
			if (passage.text.length > maxChars) {
				flush();
				for (let piece of splitLongText(passage.text, maxChars)) {
					start(passage, piece);
					flush();
				}
				continue;
			}
			if (current
					&& (current.section !== passage.section
						|| current.text.length + 1 + passage.text.length > maxChars)) {
				flush();
			}
			if (!current) {
				start(passage, passage.text);
			}
			else {
				current.text += '\n' + passage.text;
				current.pageRects.push(...passage.pageRects);
			}
		}
		flush();
		return chunks;
	}

	return { chunkPassages, splitLongText };
})();
if (typeof module === 'object') module.exports = Chunker;
