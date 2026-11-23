var Ollama = (() => {
	class OllamaError extends Error {
		constructor(message, { status, kind } = {}) {
			super(message);
			this.name = 'OllamaError';
			this.status = status;
			this.kind = kind;
		}
	}

	async function* readNDJSON(response) {
		let reader = response.body.getReader();
		let decoder = new TextDecoder();
		let buffer = '';
		while (true) {
			let { value, done } = await reader.read();
			if (done) {
				break;
			}
			buffer += decoder.decode(value, { stream: true });
			let lines = buffer.split('\n');
			buffer = lines.pop();
			for (let line of lines) {
				if (line.trim()) {
					yield JSON.parse(line);
				}
			}
		}
		buffer += decoder.decode();
		if (buffer.trim()) {
			yield JSON.parse(buffer);
		}
	}

	function kindForStatus(status) {
		if (status === 404) {
			return 'model-missing';
		}
		if (status === 403) {
			return 'forbidden';
		}
		return 'http';
	}

	class OllamaClient {
		constructor({ baseURL, fetchImpl }) {
			this.baseURL = baseURL.replace(/\/+$/, '');
			this._fetch = fetchImpl;
		}

		async _request(path, body, { method = 'POST', signal } = {}) {
			let response;
			try {
				response = await this._fetch(this.baseURL + path, {
					method,
					headers: body ? { 'Content-Type': 'application/json' } : undefined,
					body: body ? JSON.stringify(body) : undefined,
					signal,
				});
			}
			catch (e) {
				if (e && e.name === 'AbortError') {
					throw e;
				}
				throw new OllamaError(`Cannot reach Ollama at ${this.baseURL}`, { kind: 'unreachable' });
			}
			if (!response.ok) {
				let text = '';
				try {
					text = await response.text();
				}
				catch (e) {}
				throw new OllamaError(`Ollama ${path} failed (${response.status}): ${text}`, {
					status: response.status,
					kind: kindForStatus(response.status),
				});
			}
			return response;
		}

		async listModels() {
			let response = await this._request('/api/tags', null, { method: 'GET' });
			let json = await response.json();
			return (json.models || []).map(m => m.name);
		}

		async missingModels(names) {
			let normalize = n => (n.includes(':') ? n : n + ':latest');
			let available = new Set((await this.listModels()).map(normalize));
			return names.filter(n => !available.has(normalize(n)));
		}

		async embed(model, inputs) {
			let response = await this._request('/api/embed', { model, input: inputs });
			let json = await response.json();
			if (!Array.isArray(json.embeddings) || json.embeddings.length !== inputs.length) {
				throw new OllamaError('Unexpected embed response from Ollama', { kind: 'bad-response' });
			}
			return json.embeddings;
		}

		async chat({ model, messages, onToken, signal, options }) {
			let response = await this._request('/api/chat', { model, messages, stream: true, options }, { signal });
			let full = '';
			for await (let obj of readNDJSON(response)) {
				if (obj.error) {
					throw new OllamaError(obj.error, { kind: 'http' });
				}
				let token = (obj.message && obj.message.content) || '';
				if (token) {
					full += token;
					if (onToken) {
						onToken(token, full);
					}
				}
				if (obj.done) {
					break;
				}
			}
			return full;
		}
	}

	return { OllamaClient, OllamaError, readNDJSON };
})();
if (typeof module === 'object') module.exports = Ollama;
