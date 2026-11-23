var Store = (() => {
	function vectorsLib() {
		return typeof Vectors !== 'undefined' ? Vectors : require('./vectors.js');
	}

	const SCHEMA_VERSION = 1;
	let SCHEMA = [
		`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)`,
		`CREATE TABLE IF NOT EXISTS papers (
			attachmentID INTEGER PRIMARY KEY,
			itemID INTEGER,
			libraryID INTEGER,
			hash TEXT,
			status TEXT NOT NULL,
			error TEXT,
			embedModel TEXT,
			indexedAt INTEGER
		)`,
		`CREATE TABLE IF NOT EXISTS chunks (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			attachmentID INTEGER NOT NULL,
			ord INTEGER NOT NULL,
			text TEXT NOT NULL,
			section TEXT,
			pageIndex INTEGER,
			pageLabel TEXT,
			sortIndex TEXT,
			rects TEXT NOT NULL,
			source TEXT NOT NULL DEFAULT 'sdt',
			embedding TEXT
		)`,
		`CREATE INDEX IF NOT EXISTS chunks_attachment ON chunks(attachmentID)`,
	];

	class Store {
		constructor(db) {
			this.db = db;
		}

		async init() {
			for (let sql of SCHEMA) {
				await this.db.queryAsync(sql);
			}
			await this.db.queryAsync(
				`INSERT OR REPLACE INTO meta (key, value) VALUES ('schemaVersion', ?)`,
				[String(SCHEMA_VERSION)]
			);
		}

		async getPaper(attachmentID) {
			let rows = await this.db.queryAsync(
				`SELECT attachmentID, itemID, libraryID, hash, status, error, embedModel
				FROM papers WHERE attachmentID = ?`,
				[attachmentID]
			);
			if (!rows.length) {
				return null;
			}
			let r = rows[0];
			return {
				attachmentID: r.attachmentID,
				itemID: r.itemID,
				libraryID: r.libraryID,
				hash: r.hash,
				status: r.status,
				error: r.error,
				embedModel: r.embedModel,
			};
		}

		async setPaperStatus({ attachmentID, itemID, libraryID, hash, status, error = null, embedModel = null }) {
			await this.db.queryAsync(
				`INSERT OR REPLACE INTO papers
				(attachmentID, itemID, libraryID, hash, status, error, embedModel, indexedAt)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
				[attachmentID, itemID, libraryID, hash, status, error, embedModel, Date.now()]
			);
		}

		async replacePaperChunks({ attachmentID, itemID, libraryID, hash, embedModel, chunks }) {
			let { encode } = vectorsLib();
			await this.db.executeTransaction(async () => {
				await this.db.queryAsync(`DELETE FROM chunks WHERE attachmentID = ?`, [attachmentID]);
				for (let c of chunks) {
					await this.db.queryAsync(
						`INSERT INTO chunks
						(attachmentID, ord, text, section, pageIndex, pageLabel, sortIndex, rects, source, embedding)
						VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'sdt', ?)`,
						[attachmentID, c.ord, c.text, c.section, c.pageIndex, c.pageLabel, c.sortIndex,
							JSON.stringify(c.pageRects), encode(c.vec)]
					);
				}
				await this.setPaperStatus({ attachmentID, itemID, libraryID, hash, status: 'embedded', embedModel });
			});
		}

		async getChunksWithEmbeddings(attachmentID) {
			let { decode } = vectorsLib();
			let rows = await this.db.queryAsync(
				`SELECT id, ord, text, section, pageIndex, pageLabel, sortIndex, rects, embedding
				FROM chunks WHERE attachmentID = ? AND embedding IS NOT NULL ORDER BY ord`,
				[attachmentID]
			);
			return rows.map(r => ({
				id: r.id,
				ord: r.ord,
				text: r.text,
				section: r.section,
				pageIndex: r.pageIndex,
				pageLabel: r.pageLabel,
				sortIndex: r.sortIndex,
				pageRects: JSON.parse(r.rects),
				vec: decode(r.embedding),
			}));
		}

		async deletePaper(attachmentID) {
			await this.db.executeTransaction(async () => {
				await this.db.queryAsync(`DELETE FROM chunks WHERE attachmentID = ?`, [attachmentID]);
				await this.db.queryAsync(`DELETE FROM papers WHERE attachmentID = ?`, [attachmentID]);
			});
		}
	}

	return { Store, SCHEMA_VERSION };
})();
if (typeof module === 'object') module.exports = Store;
