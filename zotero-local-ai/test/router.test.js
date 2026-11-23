const { assert } = require('chai');
const Router = require('../src/router.js');

describe('Router', function () {
	for (let q of [
		'How can I cite this?',
		'give me the citation',
		'BibTeX please',
		'how do I reference this paper',
		'Come posso citare questo articolo?',
		'dammi la citazione in APA',
	]) {
		it(`detects citation intent: ${q}`, function () {
			assert.isTrue(Router.isCitationQuestion(q));
		});
	}

	for (let q of ['What are the main results?', 'Which papers are cited in the related work?', 'Summarize the method']) {
		it(`does not detect citation intent: ${q}`, function () {
			assert.isFalse(Router.isCitationQuestion(q));
		});
	}

	it('detects BibTeX requests', function () {
		assert.isTrue(Router.wantsBibTeX('bibtex entry?'));
		assert.isFalse(Router.wantsBibTeX('cite this in APA'));
	});
});
