const { assert } = require('chai');
const SDTPassages = require('../src/sdtPassages.js');

function para(text, pageRects, extra = {}) {
	return { type: 'paragraph', content: [{ text }], anchor: { pageRects }, ...extra };
}

describe('SDTPassages.structureToPassages', function () {
	let structure = {
		catalog: { pages: [{ viewRect: [0, 0, 612, 792], label: 'i' }, { viewRect: [0, 0, 612, 792] }] },
		content: [
			{ type: 'heading', content: [{ text: '1  Introduction' }], anchor: { pageRects: [[0, 72, 700, 300, 712]] } },
			para('We study  local\nmodels.', [[0, 72, 600, 540, 650]]),
			para('Page header', [[0, 72, 770, 540, 780]], { flowClass: 'excluded' }),
			{ type: 'heading', content: [{ text: '2 Results' }], anchor: { pageRects: [[1, 72, 700, 300, 712]] } },
			{ type: 'list', anchor: { pageRects: [[1, 72, 500, 540, 690]] }, content: [
				{ type: 'listItem', content: [para('First result.', [[1, 72, 650, 540, 690]])] },
				{ type: 'listItem', content: [para('Second result.', [[1, 72, 500, 540, 640]])] },
			] },
			para('[1] Smith 2020.', [[1, 72, 100, 540, 120]], { reference: true }),
			{ type: 'image', anchor: { pageRects: [[1, 0, 0, 10, 10]] } },
		],
	};

	it('assigns the current heading as section and collapses whitespace', function () {
		let passages = SDTPassages.structureToPassages(structure);
		assert.deepEqual(passages[0], {
			text: 'We study local models.',
			section: '1 Introduction',
			pageRects: [[0, 72, 600, 540, 650]],
			pageIndex: 0,
			pageLabel: '1',
			sortIndex: '00000|000000|00142',
		});
	});

	it('skips excluded blocks, references, headings and empty blocks', function () {
		let texts = SDTPassages.structureToPassages(structure).map(p => p.text);
		assert.deepEqual(texts, ['We study local models.', 'First result.\nSecond result.']);
	});

	it('uses the 1-based physical page number as label', function () {
		let passages = SDTPassages.structureToPassages(structure);
		assert.equal(passages[1].section, '2 Results');
		assert.equal(passages[1].pageLabel, '2');
	});

	it('returns [] for an empty structure', function () {
		assert.deepEqual(SDTPassages.structureToPassages({ catalog: {}, content: [] }), []);
	});
});
