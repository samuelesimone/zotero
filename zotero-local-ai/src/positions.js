var Positions = (() => {
	function round(n) {
		return Math.round(n * 1000) / 1000;
	}

	// A chunk can start with a line at the bottom of one page and continue on the
	// next, so target the page holding the largest share of its rect area
	function dominantPage(chunk) {
		let areas = new Map();
		for (let [page, x1, y1, x2, y2] of chunk.pageRects) {
			let area = Math.abs((x2 - x1) * (y2 - y1));
			areas.set(page, (areas.get(page) || 0) + area);
		}
		let best = chunk.pageIndex;
		let bestArea = -1;
		for (let [page, area] of areas) {
			if (area > bestArea) {
				best = page;
				bestArea = area;
			}
		}
		return best;
	}

	function chunkToPosition(chunk) {
		let pageIndex = dominantPage(chunk);
		let rects = chunk.pageRects
			.filter(r => r[0] === pageIndex)
			.map(r => r.slice(1, 5).map(round));
		return { pageIndex, rects };
	}

	function annotationJSON({ chunk, key, question, color = '#ffd400' }) {
		let position = chunkToPosition(chunk);
		let samePage = position.pageIndex === chunk.pageIndex;
		return {
			key,
			type: 'highlight',
			text: chunk.text,
			comment: `Local AI: ${question}`,
			color,
			pageLabel: samePage ? chunk.pageLabel : String(position.pageIndex + 1),
			sortIndex: samePage ? chunk.sortIndex : `${String(position.pageIndex).padStart(5, '0')}|000000|00000`,
			position,
			tags: [{ name: 'ai-cited' }],
		};
	}

	return { chunkToPosition, annotationJSON };
})();
if (typeof module === 'object') module.exports = Positions;
