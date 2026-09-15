const { DatabaseSync } = require('node:sqlite');
// Preserve the original better-sqlite3 call surface without a native addon.
module.exports = class Database {
  constructor(filename){this.db=new DatabaseSync(filename);}
  pragma(sql){return this.db.prepare('PRAGMA '+sql).all();}
  exec(sql){return this.db.exec(sql);}
  prepare(sql){return this.db.prepare(sql);}
  close(){return this.db.close();}
};
