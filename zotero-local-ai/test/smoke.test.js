const { assert } = require('chai');
const fs = require('fs');
const path = require('path');

describe('plugin manifest', function () {
	it('declares the Zotero plugin id and version', function () {
		let manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest.json'), 'utf8'));
		assert.equal(manifest.manifest_version, 2);
		assert.equal(manifest.applications.zotero.id, 'local-ai@samuelesimone.github.io');
		assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
	});

	it('lists only module files that exist', function () {
		let bootstrap = fs.readFileSync(path.join(__dirname, '..', 'bootstrap.js'), 'utf8');
		let files = JSON.parse(bootstrap.match(/const FILES = (\[[^\]]*\]);/)[1].replace(/'/g, '"'));
		for (let name of files) {
			assert.isTrue(fs.existsSync(path.join(__dirname, '..', 'src', name + '.js')), name);
		}
	});
});
