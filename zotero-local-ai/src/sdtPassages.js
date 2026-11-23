var SDTPassages = (() => {
	const DEFAULT_VIEW_RECT = [0, 0, 612, 792];

	function pad(n, width) {
		return String(Math.max(0, Math.round(n))).padStart(width, '0');
	}

	// Mirrors getNestedBlockPlainText() in structured-document-text/src/text.js,
	// collapsing whitespace within inline runs
	function blockText(node) {
		if (node.text !== undefined) {
			return node.text;
		}
		if (!Array.isArray(node.content)) {
			return '';
		}
		let hasChildBlock = node.content.some(child => child.text === undefined);
		if (!hasChildBlock) {
			return node.content.map(child => child.text).join('').replace(/\s+/g, ' ').trim();
		}
		let parts = [];
		for (let child of node.content) {
			if (child.text !== undefined) {
				continue;
			}
			let text = blockText(child);
			if (text) {
				parts.push(text);
			}
		}
		return parts.join('\n');
	}

	function isValidPageRect(r) {
		return Array.isArray(r) && r.length >= 5 && r.slice(0, 5).every(Number.isFinite);
	}

	function makeSortIndex(pages, pageRect) {
		let [pageIndex, , , , y2] = pageRect;
		let viewRect = (pages[pageIndex] && pages[pageIndex].viewRect) || DEFAULT_VIEW_RECT;
		let top = viewRect[3] - y2;
		return `${pad(pageIndex, 5)}|${pad(0, 6)}|${pad(top, 5)}`;
	}

	// SDT's detected page labels are unreliable on some PDFs (e.g. ["2", "-", "3"]
	// for an arXiv paper), so use the physical page number shown in the reader toolbar
	function pageLabel(pages, pageIndex) {
		return String(pageIndex + 1);
	}

	function structureToPassages(structure) {
		let pages = (structure.catalog && structure.catalog.pages) || [];
		let passages = [];
		let section = '';
		for (let block of structure.content || []) {
			if (!block || block.flowClass === 'excluded') {
				continue;
			}
			let text = blockText(block);
			if (!text) {
				continue;
			}
			if (block.type === 'heading') {
				section = text;
				continue;
			}
			if (block.reference) {
				continue;
			}
			let pageRects = ((block.anchor && block.anchor.pageRects) || [])
				.filter(isValidPageRect)
				.map(r => r.slice(0, 5));
			let first = pageRects[0];
			passages.push({
				text,
				section,
				pageRects,
				pageIndex: first ? first[0] : null,
				pageLabel: first ? pageLabel(pages, first[0]) : '',
				sortIndex: first ? makeSortIndex(pages, first) : '',
			});
		}
		return passages;
	}

	return { structureToPassages, makeSortIndex };
})();
if (typeof module === 'object') module.exports = SDTPassages;
