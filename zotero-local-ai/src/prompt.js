var Prompt = (() => {
	const HISTORY_LIMIT = 6;
	const SYSTEM = [
		'You are a research assistant inside Zotero. Answer the question using ONLY the numbered sources from the paper.',
		'Rules:',
		'- Cite every claim with its source number in square brackets, e.g. [2] or [1][3].',
		'- Only use source numbers that appear in the sources.',
		'- If the sources do not contain the answer, say so plainly instead of guessing.',
		'- Answer in the same language as the question. Be concise and precise.',
	].join('\n');
	
	function formatSource(source, i) {
		let where = `p. ${source.pageLabel}` + (source.section ? `, ${source.section}` : '');
		return `[${i + 1}] (${where})\n${source.text}`;
	}
	
	function buildMessages({ question, sources, paperTitle, history = [] }) {
		let context = sources.map(formatSource).join('\n\n');
		return [
			{ role: 'system', content: SYSTEM },
			...history.slice(-HISTORY_LIMIT),
			{ role: 'user', content: `Paper: ${paperTitle}\n\nSources:\n${context}\n\nQuestion: ${question}` },
		];
	}
	
	function parseCitations(text, sourceCount) {
		let segments = [];
		let cited = [];
		let re = /\[(\d+(?:\s*[,;]\s*\d+)*)\]/g;
		let last = 0;
		let match;
		while ((match = re.exec(text))) {
			if (match.index > last) {
				segments.push({ type: 'text', text: text.slice(last, match.index) });
			}
			for (let part of match[1].split(/[,;]/)) {
				let n = parseInt(part.trim(), 10);
				if (n >= 1 && n <= sourceCount) {
					segments.push({ type: 'cite', n });
					if (!cited.includes(n)) {
						cited.push(n);
					}
				}
			}
			last = re.lastIndex;
		}
		if (last < text.length) {
			segments.push({ type: 'text', text: text.slice(last) });
		}
		return { segments, cited };
	}
	
	return { buildMessages, parseCitations, SYSTEM };
})();
if (typeof module === 'object') module.exports = Prompt;
