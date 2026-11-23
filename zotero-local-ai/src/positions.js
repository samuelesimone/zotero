var Positions = (() => {
	function round(n) {
		return Math.round(n * 1000) / 1000;
	}
	
	function chunkToPosition(chunk) {
		let rects = chunk.pageRects
			.filter(r => r[0] === chunk.pageIndex)
			.map(r => r.slice(1, 5).map(round));
		return { pageIndex: chunk.pageIndex, rects };
	}
	
	function annotationJSON({ chunk, key, question, color = '#ffd400' }) {
		return {
			key,
			type: 'highlight',
			text: chunk.text,
			comment: `Local AI: ${question}`,
			color,
			pageLabel: chunk.pageLabel,
			sortIndex: chunk.sortIndex,
			position: chunkToPosition(chunk),
			tags: [{ name: 'ai-cited' }],
		};
	}
	
	return { chunkToPosition, annotationJSON };
})();
if (typeof module === 'object') module.exports = Positions;
