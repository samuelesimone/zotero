const { assert } = require('chai');
const Prompt = require('../src/prompt.js');

describe('Prompt.buildMessages', function () {
	it('numbers sources with page and section', function () {
		let messages = Prompt.buildMessages({
			question: 'What are the main results?',
			paperTitle: 'Local Models',
			sources: [
				{ text: 'Accuracy is 91%.', pageLabel: '5', section: '4 Results' },
				{ text: 'We use ImageNet.', pageLabel: '3', section: '' },
			],
		});
		assert.equal(messages[0].role, 'system');
		assert.include(messages[0].content, 'square brackets');
		let user = messages[messages.length - 1];
		assert.equal(user.role, 'user');
		assert.include(user.content, 'Paper: Local Models');
		assert.include(user.content, '[1] (p. 5, 4 Results)\nAccuracy is 91%.');
		assert.include(user.content, '[2] (p. 3)\nWe use ImageNet.');
		assert.include(user.content, 'Question: What are the main results?');
	});

	it('keeps only the last 6 history messages', function () {
		let history = Array.from({ length: 10 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `m${i}` }));
		let messages = Prompt.buildMessages({ question: 'q', paperTitle: 't', sources: [], history });
		assert.lengthOf(messages, 8);
		assert.equal(messages[1].content, 'm4');
	});
});

describe('Prompt.parseCitations', function () {
	it('splits text and valid citation markers', function () {
		let { segments, cited } = Prompt.parseCitations('Accuracy is 91% [1]. Uses ImageNet [2][1].', 2);
		assert.deepEqual(segments, [
			{ type: 'text', text: 'Accuracy is 91% ' },
			{ type: 'cite', n: 1 },
			{ type: 'text', text: '. Uses ImageNet ' },
			{ type: 'cite', n: 2 },
			{ type: 'cite', n: 1 },
			{ type: 'text', text: '.' },
		]);
		assert.deepEqual(cited, [1, 2]);
	});

	it('expands comma lists and drops invalid numbers', function () {
		let { segments, cited } = Prompt.parseCitations('Claim [1, 3, 9].', 3);
		assert.deepEqual(segments, [
			{ type: 'text', text: 'Claim ' },
			{ type: 'cite', n: 1 },
			{ type: 'cite', n: 3 },
			{ type: 'text', text: '.' },
		]);
		assert.deepEqual(cited, [1, 3]);
	});

	it('removes a marker with no valid numbers', function () {
		let { segments, cited } = Prompt.parseCitations('Made up [7].', 2);
		assert.deepEqual(segments, [{ type: 'text', text: 'Made up ' }, { type: 'text', text: '.' }]);
		assert.deepEqual(cited, []);
	});

	it('returns plain text when there are no markers', function () {
		assert.deepEqual(Prompt.parseCitations('Not found in this paper.', 3).segments, [{ type: 'text', text: 'Not found in this paper.' }]);
	});
});
