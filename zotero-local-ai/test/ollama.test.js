const { assert } = require('chai');
const { OllamaClient, OllamaError } = require('../src/ollama.js');

function jsonResponse(obj, status = 200) {
	return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}

function streamResponse(parts) {
	let encoder = new TextEncoder();
	let stream = new ReadableStream({
		start(controller) {
			for (let part of parts) {
				controller.enqueue(encoder.encode(part));
			}
			controller.close();
		},
	});
	return new Response(stream, { status: 200 });
}

describe('OllamaClient', function () {
	it('lists model names', async function () {
		let calls = [];
		let client = new OllamaClient({
			baseURL: 'http://localhost:11434/',
			fetchImpl: async (url, init) => {
				calls.push({ url, init });
				return jsonResponse({ models: [{ name: 'gemma4:12b' }, { name: 'nomic-embed-text:latest' }] });
			},
		});
		assert.deepEqual(await client.listModels(), ['gemma4:12b', 'nomic-embed-text:latest']);
		assert.equal(calls[0].url, 'http://localhost:11434/api/tags');
		assert.equal(calls[0].init.method, 'GET');
	});

	it('reports missing models, treating a bare name as :latest', async function () {
		let client = new OllamaClient({
			baseURL: 'http://x',
			fetchImpl: async () => jsonResponse({ models: [{ name: 'nomic-embed-text:latest' }] }),
		});
		assert.deepEqual(await client.missingModels(['nomic-embed-text', 'gemma4:12b']), ['gemma4:12b']);
	});

	it('embeds a batch of inputs', async function () {
		let body;
		let client = new OllamaClient({
			baseURL: 'http://x',
			fetchImpl: async (url, init) => {
				body = JSON.parse(init.body);
				return jsonResponse({ embeddings: [[1, 0], [0, 1]] });
			},
		});
		let result = await client.embed('nomic-embed-text', ['a', 'b']);
		assert.deepEqual(result, [[1, 0], [0, 1]]);
		assert.deepEqual(body, { model: 'nomic-embed-text', input: ['a', 'b'] });
	});

	it('rejects an embed response with the wrong length', async function () {
		let client = new OllamaClient({ baseURL: 'http://x', fetchImpl: async () => jsonResponse({ embeddings: [[1]] }) });
		try {
			await client.embed('m', ['a', 'b']);
			assert.fail('should throw');
		}
		catch (e) {
			assert.instanceOf(e, OllamaError);
			assert.equal(e.kind, 'bad-response');
		}
	});

	it('streams chat tokens across chunk boundaries', async function () {
		let tokens = [];
		let client = new OllamaClient({
			baseURL: 'http://x',
			fetchImpl: async () => streamResponse([
				'{"message":{"role":"assistant","content":"Hel"},"done":false}\n{"mess',
				'age":{"role":"assistant","content":"lo"},"done":false}\n',
				'{"message":{"role":"assistant","content":""},"done":true}\n',
			]),
		});
		let full = await client.chat({
			model: 'gemma4:12b',
			messages: [{ role: 'user', content: 'hi' }],
			onToken: (token, text) => tokens.push([token, text]),
		});
		assert.equal(full, 'Hello');
		assert.deepEqual(tokens, [['Hel', 'Hel'], ['lo', 'Hello']]);
	});

	it('maps 404 to model-missing', async function () {
		let client = new OllamaClient({
			baseURL: 'http://x',
			fetchImpl: async () => jsonResponse({ error: "model 'gemma4:12b' not found" }, 404),
		});
		try {
			await client.chat({ model: 'gemma4:12b', messages: [] });
			assert.fail('should throw');
		}
		catch (e) {
			assert.equal(e.kind, 'model-missing');
			assert.equal(e.status, 404);
		}
	});

	it('maps 403 to forbidden', async function () {
		let client = new OllamaClient({ baseURL: 'http://x', fetchImpl: async () => new Response('', { status: 403 }) });
		try {
			await client.listModels();
			assert.fail('should throw');
		}
		catch (e) {
			assert.equal(e.kind, 'forbidden');
		}
	});

	it('maps network failure to unreachable', async function () {
		let client = new OllamaClient({ baseURL: 'http://x', fetchImpl: async () => { throw new TypeError('NetworkError'); } });
		try {
			await client.listModels();
			assert.fail('should throw');
		}
		catch (e) {
			assert.equal(e.kind, 'unreachable');
		}
	});
});
