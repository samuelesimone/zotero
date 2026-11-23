const { assert } = require('chai');
const Positions = require('../src/positions.js');

let chunk = {
	text: 'Accuracy is 91%.',
	pageIndex: 4,
	pageLabel: '5',
	sortIndex: '00004|000000|00120',
	pageRects: [[4, 72.12345, 600, 540, 650], [4, 72, 500, 540, 590], [5, 72, 700, 540, 720]],
};

describe('Positions', function () {
	it('builds a reader position from rects on the first page', function () {
		assert.deepEqual(Positions.chunkToPosition(chunk), {
			pageIndex: 4,
			rects: [[72.123, 600, 540, 650], [72, 500, 540, 590]],
		});
	});

	it('builds highlight annotation JSON', function () {
		let json = Positions.annotationJSON({ chunk, key: 'ABCD2345', question: 'What is the accuracy?' });
		assert.deepEqual(json, {
			key: 'ABCD2345',
			type: 'highlight',
			text: 'Accuracy is 91%.',
			comment: 'Local AI: What is the accuracy?',
			color: '#ffd400',
			pageLabel: '5',
			sortIndex: '00004|000000|00120',
			position: { pageIndex: 4, rects: [[72.123, 600, 540, 650], [72, 500, 540, 590]] },
			tags: [{ name: 'ai-cited' }],
		});
	});
});
