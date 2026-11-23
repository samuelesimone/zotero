const initSqlJs = require('sql.js');

// Minimal stand-in for Zotero.DBConnection backed by in-memory sql.js
async function createAdapter() {
	let SQL = await initSqlJs();
	let db = new SQL.Database();
	let toParams = params => (params || []).map(v => (v === undefined ? null : v));
	return {
		async queryAsync(sql, params) {
			let stmt = db.prepare(sql);
			try {
				stmt.bind(toParams(params));
				let rows = [];
				while (stmt.step()) {
					rows.push(stmt.getAsObject());
				}
				return rows;
			}
			finally {
				stmt.free();
			}
		},
		async valueQueryAsync(sql, params) {
			let rows = await this.queryAsync(sql, params);
			if (!rows.length) {
				return false;
			}
			return Object.values(rows[0])[0];
		},
		async executeTransaction(fn) {
			db.run('BEGIN');
			try {
				let result = await fn();
				db.run('COMMIT');
				return result;
			}
			catch (e) {
				db.run('ROLLBACK');
				throw e;
			}
		},
	};
}

module.exports = { createAdapter };
