var ChatController = (() => {
	function libs() {
		return {
			Router: typeof Router !== 'undefined' ? Router : require('./router.js'),
			PaperIndex: typeof PaperIndex !== 'undefined' ? PaperIndex : require('./paperIndex.js'),
			Retriever: typeof Retriever !== 'undefined' ? Retriever : require('./retriever.js'),
			Prompt: typeof Prompt !== 'undefined' ? Prompt : require('./prompt.js'),
		};
	}

	function errorMessage(error, config) {
		switch (error && error.kind) {
			case 'unreachable':
				return 'Ollama is not running. Start it (open the Ollama app or run `ollama serve`) and try again.';
			case 'model-missing':
				return `A model is missing. Run \`ollama pull ${config.chatModel}\` and \`ollama pull ${config.embedModel}\`, then try again.`;
			case 'forbidden':
				return 'Ollama refused the request from Zotero. Run `launchctl setenv OLLAMA_ORIGINS "*"`, restart Ollama, and try again.';
			default:
				return `Something went wrong: ${error && error.message ? error.message : error}`;
		}
	}

	function progressText(p) {
		if (p.stage === 'extracting') {
			return 'Reading the paper…';
		}
		if (p.stage === 'embedding') {
			return `Indexing the paper (${p.done}/${p.total})…`;
		}
		return '';
	}

	class ChatController {
		constructor({ attachment, item, paperTitle, deps }) {
			this.attachment = attachment;
			this.item = item;
			this.paperTitle = paperTitle;
			this.deps = deps;
			this.history = [];
		}

		async ask(question, { onStatus, onToken } = {}) {
			let { Router, PaperIndex, Retriever, Prompt } = libs();
			let status = onStatus || (() => {});
			let { ollama, store, getPassages, citations, config } = this.deps;
			try {
				if (Router.isCitationQuestion(question)) {
					let result = { kind: 'citation', ...citations.formatBibliography(this.item) };
					if (Router.wantsBibTeX(question)) {
						result.bibtex = await citations.exportBibTeX(this.item);
					}
					return result;
				}

				let index = await PaperIndex.ensureIndexed({
					attachment: this.attachment,
					store,
					ollama,
					getPassages,
					embedModel: config.embedModel,
					onProgress: p => status(progressText(p)),
				});
				if (index.status === 'no-text') {
					return { kind: 'error', message: 'This PDF has no selectable text (it may be a scan). OCR support is coming in a later version.' };
				}
				if (index.status !== 'embedded') {
					return { kind: 'error', message: `This PDF could not be read (${index.reason}).` };
				}

				status('Searching the paper…');
				let sources = await Retriever.retrieveForPaper({
					question,
					attachmentID: this.attachment.id,
					store,
					ollama,
					embedModel: config.embedModel,
				});
				let messages = Prompt.buildMessages({ question, sources, paperTitle: this.paperTitle, history: this.history });
				status('Thinking…');
				let answer = await ollama.chat({
					model: config.chatModel,
					messages,
					onToken: (token, full) => onToken && onToken(full),
				});
				this.history.push({ role: 'user', content: question }, { role: 'assistant', content: answer });
				let { segments, cited } = Prompt.parseCitations(answer, sources.length);
				return { kind: 'answer', segments, sources, cited };
			}
			catch (e) {
				return { kind: 'error', message: errorMessage(e, config) };
			}
		}
	}

	return { ChatController, errorMessage };
})();
if (typeof module === 'object') module.exports = ChatController;
