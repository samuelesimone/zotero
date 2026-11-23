// Dev-only self-check. Loaded by bootstrap.js only when the pref
// extensions.zotero-local-ai.devcheck holds a path to a PDF. Not packaged in the xpi.
var DevCheck = (() => {
	const TITLE = 'Attention Is All You Need';

	function log(label, value) {
		Zotero.debug('[LocalAI][devcheck] ' + label + ': ' + (typeof value === 'string' ? value : JSON.stringify(value)));
	}

	async function getFixture(pdfPath) {
		let s = new Zotero.Search();
		s.libraryID = Zotero.Libraries.userLibraryID;
		s.addCondition('title', 'is', TITLE);
		s.addCondition('itemType', 'is', 'journalArticle');
		let ids = await s.search();
		let parent = ids.length ? await Zotero.Items.getAsync(ids[0]) : null;
		if (parent) {
			await parent.loadAllData();
		}
		if (!parent) {
			parent = new Zotero.Item('journalArticle');
			parent.libraryID = Zotero.Libraries.userLibraryID;
			parent.setField('title', TITLE);
			parent.setField('date', '2017');
			parent.setField('publicationTitle', 'Advances in Neural Information Processing Systems');
			parent.setCreators([
				{ firstName: 'Ashish', lastName: 'Vaswani', creatorType: 'author' },
				{ firstName: 'Noam', lastName: 'Shazeer', creatorType: 'author' },
			]);
			await parent.saveTx();
		}
		let attachment = (await parent.getBestAttachments())[0];
		if (!attachment) {
			attachment = await Zotero.Attachments.importFromFile({ file: pdfPath, parentItemID: parent.id });
		}
		return { parent, attachment };
	}

	async function run(pdfPath, { ask } = {}) {
		try {
			let { parent, attachment } = await getFixture(pdfPath);
			log('attachment', { id: attachment.id, isPDF: attachment.isPDFAttachment() });

			let sdt = await Zotero.SDT.getReader(attachment.id);
			let catalog = await sdt.getCatalog();
			log('pageLabels', (catalog.pages || []).slice(0, 6).map(p => p.label));
			
			let extracted = await Extract.getPassages(attachment.id);
			log('extract.ok', extracted.ok);
			if (extracted.ok) {
				let chunks = Chunker.chunkPassages(extracted.passages);
				log('passages', extracted.passages.length);
				log('chunks', chunks.length);
				log('sections', [...new Set(chunks.map(c => c.section))].slice(0, 12));
				for (let c of chunks.slice(0, 3)) {
					log('chunk', { ord: c.ord, section: c.section, pageIndex: c.pageIndex, pageLabel: c.pageLabel, sortIndex: c.sortIndex, rects: c.pageRects.slice(0, 2), text: c.text.slice(0, 120) });
				}
			}

			log('citation', await Citations.formatBibliography(parent));
			log('bibtex', await Citations.exportBibTeX(parent));

			if (ask) {
				let controller = await LocalAI.makeController(attachment.id);
				let t = Date.now();
				let result = await controller.ask(ask, { onStatus: s => log('status', s) });
				log('ask.ms', Date.now() - t);
				log('ask.result', {
					kind: result.kind,
					message: result.message,
					cited: result.cited,
					text: result.segments && result.segments.map(s => (s.type === 'text' ? s.text : `[${s.n}]`)).join(''),
					sources: result.sources && result.sources.map(s => ({ page: s.pageLabel, section: s.section, score: Math.round(s.score * 1000) / 1000 })),
				});
				if (result.kind === 'answer' && result.cited.length) {
					let source = result.sources[result.cited[0] - 1];
					await Highlight.showSource(attachment.id, source);
					let position = Positions.chunkToPosition(source);
					log('showSource', { targetPage: position.pageIndex + 1, rects: position.rects, text: source.text.slice(0, 160) });
					await Zotero.Promise.delay(1500);
					let win = Zotero.getMainWindow();
					let reader = Zotero.Reader.getByTabID(win.Zotero_Tabs.selectedID);
					let viewer = null;
					try {
						viewer = reader._internalReader._primaryView._iframeWindow.wrappedJSObject.PDFViewerApplication.pdfViewer;
					}
					catch (e) {}
					log('reader', {
						selectedTabIsReader: !!reader,
						readerItemID: reader && reader.itemID,
						currentPage: viewer ? viewer.currentPageNumber : 'unknown',
					});

					let annotation = await Highlight.saveAsAnnotation(attachment.id, source, ask);
					log('annotation', {
						saved: !!annotation.id,
						type: annotation.annotationType,
						tags: annotation.getTags().map(t => t.tag),
						comment: annotation.annotationComment,
						pageLabel: annotation.annotationPageLabel,
						position: JSON.parse(annotation.annotationPosition).pageIndex,
					});
					await annotation.eraseTx();
				}
			}
			log('done', 'ok');
		}
		catch (e) {
			log('error', e && (e.stack || e.message) || String(e));
		}
	}

	return { run };
})();
