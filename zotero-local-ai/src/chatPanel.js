var ChatPanel = (() => {
	const HTML_NS = 'http://www.w3.org/1999/xhtml';
	const STYLE = `
		.lai-root { display: flex; flex-direction: column; gap: 8px; padding: 4px 0; }
		.lai-messages { display: flex; flex-direction: column; gap: 8px; max-height: 60vh; overflow-y: auto; }
		.lai-msg { padding: 6px 8px; border-radius: 6px; white-space: pre-wrap; line-height: 1.4; user-select: text; }
		.lai-user { background: var(--fill-quinary); align-self: flex-end; max-width: 90%; }
		.lai-assistant { background: var(--material-sidepane); border: 1px solid var(--fill-quinary); }
		.lai-error { color: var(--accent-red); border: 1px solid var(--accent-red); }
		.lai-status { color: var(--fill-secondary); font-size: 0.9em; min-height: 1.2em; }
		.lai-cite { display: inline-block; margin: 0 1px; padding: 0 5px; border-radius: 8px; border: none; cursor: pointer;
			background: var(--accent-blue10); color: var(--accent-blue); font-size: 0.85em; }
		.lai-cite:hover { background: var(--accent-blue30); }
		.lai-sources { margin-top: 6px; display: flex; flex-direction: column; gap: 4px; font-size: 0.9em; }
		.lai-source { display: flex; gap: 6px; align-items: baseline; }
		.lai-source-text { flex: 1; color: var(--fill-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; }
		.lai-save { font-size: 0.85em; }
		.lai-code { font-family: monospace; font-size: 0.9em; padding: 6px; background: var(--fill-quinary); border-radius: 4px; white-space: pre-wrap; user-select: text; }
		.lai-input-row { display: flex; gap: 6px; }
		.lai-input { flex: 1; resize: vertical; min-height: 2.5em; font: inherit; }
	`;

	let _states = new WeakMap();

	function el(doc, tag, className, text) {
		let node = doc.createElementNS(HTML_NS, tag);
		if (className) {
			node.className = className;
		}
		if (text !== undefined) {
			node.textContent = text;
		}
		return node;
	}

	function currentAttachmentID(doc) {
		let win = doc.defaultView;
		let tabs = win.Zotero_Tabs;
		if (!tabs) {
			return null;
		}
		let reader = Zotero.Reader.getByTabID(tabs.selectedID);
		return reader ? reader.itemID : null;
	}

	function renderCitation(doc, container, result) {
		container.append(el(doc, 'div', null, `Citation (${result.style}):`));
		container.append(el(doc, 'div', 'lai-code', result.bibliography));
		container.append(el(doc, 'div', null, 'In-text:'));
		container.append(el(doc, 'div', 'lai-code', result.inText));
		if (result.bibtex) {
			container.append(el(doc, 'div', null, 'BibTeX:'));
			container.append(el(doc, 'div', 'lai-code', result.bibtex));
		}
	}

	function renderAnswer(doc, container, result, { attachmentID, question, highlight }) {
		container.textContent = '';
		let body = el(doc, 'div');
		for (let seg of result.segments) {
			if (seg.type === 'text') {
				body.append(doc.createTextNode(seg.text));
				continue;
			}
			let source = result.sources[seg.n - 1];
			let chip = el(doc, 'button', 'lai-cite', String(seg.n));
			chip.title = `p. ${source.pageLabel}${source.section ? ' – ' + source.section : ''}`;
			chip.addEventListener('click', () => highlight.showSource(attachmentID, source));
			body.append(chip);
		}
		container.append(body);

		if (!result.cited.length) {
			return;
		}
		let list = el(doc, 'div', 'lai-sources');
		for (let n of result.cited) {
			let source = result.sources[n - 1];
			let row = el(doc, 'div', 'lai-source');
			row.append(el(doc, 'span', null, `[${n}] p. ${source.pageLabel}`));
			let text = el(doc, 'span', 'lai-source-text', source.text);
			text.title = source.text;
			text.addEventListener('click', () => highlight.showSource(attachmentID, source));
			row.append(text);
			let save = el(doc, 'button', 'lai-save', 'Save');
			save.title = 'Save as a highlight annotation';
			save.addEventListener('click', async () => {
				save.disabled = true;
				try {
					await highlight.saveAsAnnotation(attachmentID, source, question);
					save.textContent = 'Saved';
				}
				catch (e) {
					Zotero.logError(e);
					save.textContent = 'Failed';
					save.disabled = false;
				}
			});
			row.append(save);
			list.append(row);
		}
		container.append(list);
	}

	function buildUI(doc, body) {
		body.textContent = '';
		let root = el(doc, 'div', 'lai-root');
		root.append(el(doc, 'style', null, STYLE));
		let messages = el(doc, 'div', 'lai-messages');
		let status = el(doc, 'div', 'lai-status');
		let row = el(doc, 'div', 'lai-input-row');
		let input = el(doc, 'textarea', 'lai-input');
		input.placeholder = 'Ask about this paper… (Enter to send)';
		let send = el(doc, 'button', null, 'Ask');
		row.append(input, send);
		root.append(messages, status, row);
		body.append(root);
		return { messages, status, input, send };
	}

	function register({ pluginID, rootURI, makeController, highlight }) {
		return Zotero.ItemPaneManager.registerSection({
			paneID: 'local-ai-chat',
			pluginID,
			header: { l10nID: 'local-ai-pane-header', icon: rootURI + 'content/icons/ai16.svg' },
			sidenav: { l10nID: 'local-ai-pane-sidenav', icon: rootURI + 'content/icons/ai20.svg' },
			onItemChange: ({ tabType, setEnabled }) => {
				setEnabled(tabType === 'reader');
			},
			onRender: ({ doc, body }) => {
				let attachmentID = currentAttachmentID(doc);
				let state = _states.get(body);
				if (state && state.attachmentID === attachmentID) {
					return;
				}
				let ui = buildUI(doc, body);
				state = { attachmentID, controller: null, busy: false, ui };
				_states.set(body, state);

				let ask = async () => {
					let question = ui.input.value.trim();
					if (!question || state.busy || !state.attachmentID) {
						return;
					}
					state.busy = true;
					ui.send.disabled = true;
					ui.input.value = '';
					ui.messages.append(el(doc, 'div', 'lai-msg lai-user', question));
					let answerBox = el(doc, 'div', 'lai-msg lai-assistant', '…');
					ui.messages.append(answerBox);
					ui.messages.scrollTop = ui.messages.scrollHeight;
					try {
						if (!state.controller) {
							state.controller = await makeController(state.attachmentID);
						}
						if (!state.controller) {
							answerBox.textContent = 'This item is not a PDF. Open a PDF to chat with it.';
							return;
						}
						let result = await state.controller.ask(question, {
							onStatus: (text) => {
								ui.status.textContent = text;
							},
							onToken: (full) => {
								answerBox.textContent = full;
								ui.messages.scrollTop = ui.messages.scrollHeight;
							},
						});
						if (result.kind === 'citation') {
							answerBox.textContent = '';
							renderCitation(doc, answerBox, result);
						}
						else if (result.kind === 'answer') {
							renderAnswer(doc, answerBox, result, { attachmentID: state.attachmentID, question, highlight });
						}
						else {
							answerBox.textContent = result.message;
							answerBox.classList.add('lai-error');
						}
					}
					catch (e) {
						Zotero.logError(e);
						answerBox.textContent = `Something went wrong: ${e.message}`;
						answerBox.classList.add('lai-error');
					}
					finally {
						ui.status.textContent = '';
						state.busy = false;
						ui.send.disabled = false;
						ui.messages.scrollTop = ui.messages.scrollHeight;
					}
				};

				ui.send.addEventListener('click', ask);
				ui.input.addEventListener('keydown', (event) => {
					if (event.key === 'Enter' && !event.shiftKey) {
						event.preventDefault();
						ask();
					}
				});
			},
		});
	}

	function unregister(paneID) {
		if (paneID) {
			Zotero.ItemPaneManager.unregisterSection(paneID);
		}
	}

	return { register, unregister };
})();
