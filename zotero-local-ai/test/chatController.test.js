const { assert } = require('chai');
const { ChatController, errorMessage } = require('../src/chatController.js');
const { OllamaError } = require('../src/ollama.js');
const { createAdapter } = require('./helpers/sqljsAdapter.js');
const { Store } = require('../src/store.js');

let config = { chatModel: 'gemma4:12b', embedModel: 'nomic-embed-text' };
let attachment = { id: 1, itemID: 10, libraryID: 1, hash: 'h' };

function passages() {
	return [
		{ text: 'The model reaches 91% accuracy on ImageNet.', section: 'Results', pageRects: [[4, 0, 0, 1, 1]], pageIndex: 4, pageLabel: '5', sortIndex: 's' },
		{ text: 'We train with a local GPU for three days.', section: 'Methods', pageRects: [[2, 0, 0, 1, 1]], pageIndex: 2, pageLabel: '3', sortIndex: 's' },
	];
}

async function makeController(overrides = {}) {
	let store = new Store(await createAdapter());
	await store.init();
	let chatCalls = [];
	let ollama = {
		async embed(model, inputs) {
			return inputs.map(t => (t.includes('accuracy') ? [1, 0] : [0, 1]));
		},
		async chat(args) {
			chatCalls.push(args);
			args.onToken('The accuracy is 91% [1]', 'The accuracy is 91% [1]');
			return 'The accuracy is 91% [1] [5].';
		},
		...overrides.ollama,
	};
	let citations = {
		formatBibliography: () => ({ style: 'APA', bibliography: 'Doe, J. (2024). Local Models.', inText: '(Doe, 2024)' }),
		exportBibTeX: async () => '@article{doe2024}',
	};
	let controller = new ChatController({
		attachment, item: { id: 10 }, paperTitle: 'Local Models',
		deps: { ollama, store, citations, config, getPassages: overrides.getPassages || (async () => ({ ok: true, passages: passages() })) },
	});
	return { controller, chatCalls };
}

describe('ChatController.ask', function () {
	it('answers citation questions from Zotero without calling the LLM', async function () {
		let { controller, chatCalls } = await makeController();
		let result = await controller.ask('How can I cite this?');
		assert.deepEqual(result, { kind: 'citation', style: 'APA', bibliography: 'Doe, J. (2024). Local Models.', inText: '(Doe, 2024)' });
		assert.lengthOf(chatCalls, 0);
	});

	it('adds BibTeX when asked', async function () {
		let { controller } = await makeController();
		let result = await controller.ask('bibtex citation please');
		assert.equal(result.bibtex, '@article{doe2024}');
	});

	it('indexes, retrieves, streams and returns validated citations', async function () {
		let { controller, chatCalls } = await makeController();
		let statuses = [];
		let streamed = [];
		let result = await controller.ask('What is the accuracy?', { onStatus: s => statuses.push(s), onToken: t => streamed.push(t) });
		assert.equal(result.kind, 'answer');
		assert.deepEqual(result.cited, [1]);
		assert.equal(result.sources[0].text, 'The model reaches 91% accuracy on ImageNet.');
		assert.notInclude(JSON.stringify(result.segments), '"n":5');
		assert.equal(chatCalls[0].model, 'gemma4:12b');
		assert.deepEqual(streamed, ['The accuracy is 91% [1]']);
		assert.include(statuses.join('|'), 'Reading the paper');
		assert.include(statuses.join('|'), 'Thinking');
		assert.deepEqual(controller.history, [
			{ role: 'user', content: 'What is the accuracy?' },
			{ role: 'assistant', content: 'The accuracy is 91% [1] [5].' },
		]);
	});

	it('reports a paper without text', async function () {
		let { controller } = await makeController({ getPassages: async () => ({ ok: true, passages: [] }) });
		let result = await controller.ask('What is this about?');
		assert.equal(result.kind, 'error');
		assert.include(result.message, 'no selectable text');
	});

	it('turns Ollama errors into actionable messages and leaves history untouched', async function () {
		let { controller } = await makeController({
			ollama: { async chat() { throw new OllamaError('nope', { kind: 'model-missing', status: 404 }); } },
		});
		let result = await controller.ask('What is the accuracy?');
		assert.deepEqual(result, { kind: 'error', message: errorMessage(new OllamaError('nope', { kind: 'model-missing' }), config) });
		assert.lengthOf(controller.history, 0);
	});
});

describe('ChatController.errorMessage', function () {
	it('explains how to fix each failure kind', function () {
		assert.include(errorMessage(new OllamaError('x', { kind: 'unreachable' }), config), 'ollama serve');
		assert.include(errorMessage(new OllamaError('x', { kind: 'model-missing' }), config), 'ollama pull gemma4:12b');
		assert.include(errorMessage(new OllamaError('x', { kind: 'model-missing' }), config), 'ollama pull nomic-embed-text');
		assert.include(errorMessage(new OllamaError('x', { kind: 'forbidden' }), config), 'OLLAMA_ORIGINS');
		assert.include(errorMessage(new Error('boom'), config), 'boom');
	});
});
