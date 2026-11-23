var Router = (() => {
	let CITATION_PATTERNS = [
		/\bcit(e|ing|ation)\b/i,
		/\bbibtex\b/i,
		/\bbibliograph/i,
		/\bhow (do|can|should) i reference\b/i,
		/\bcitar[ei]\b/i,
		/\bcitazione\b/i,
		/\bbibliografi/i,
	];
	
	function isCitationQuestion(question) {
		return CITATION_PATTERNS.some(re => re.test(question));
	}
	
	function wantsBibTeX(question) {
		return /\bbibtex\b/i.test(question);
	}
	
	return { isCitationQuestion, wantsBibTeX };
})();
if (typeof module === 'object') module.exports = Router;
