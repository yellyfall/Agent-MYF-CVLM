import { mkdirSync } from 'node:fs';
import path from 'node:path';
export async function openStore(env) {
  let query, close;
  if (env.DATABASE_URL) {
    const {Pool} = await import('pg');
    const pool = new Pool({connectionString:env.DATABASE_URL,max:3,idleTimeoutMillis:10000,connectionTimeoutMillis:10000,statement_timeout:10000});
    pool.on('error', () => console.error('Connexion PostgreSQL interrompue.'));
    query = async (sql, params=[]) => (await pool.query(sql,params)).rows;
    close = () => pool.end();
  } else {
    if (env.RENDER) throw new Error('DATABASE_URL requise sur Render : le stockage local gratuit est éphémère.');
    const {DatabaseSync} = await import('node:sqlite');
    const dir = env.DATA_DIR || './data';
    mkdirSync(dir,{recursive:true});
    const db = new DatabaseSync(path.join(dir,'candidature.db'));
    db.exec('PRAGMA journal_mode=WAL; PRAGMA cache_size=-2000; PRAGMA busy_timeout=5000;');
    query = async (sql,params=[]) => {
      const stmt=db.prepare(sql.replace(/\$\d+/g,'?'));
      return /^(SELECT|INSERT.*RETURNING|UPDATE.*RETURNING)/is.test(sql.trim()) ? stmt.all(...params) : (stmt.run(...params),[]);
    };
    close = () => db.close();
  }
  await query(`CREATE TABLE IF NOT EXISTS app_users (
    id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, fullname TEXT NOT NULL,
    password TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'user', status TEXT NOT NULL DEFAULT 'active',
    expires_at TEXT, version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
  )`);
  await query(`CREATE TABLE IF NOT EXISTS app_usage (user_id TEXT NOT NULL, day TEXT NOT NULL, count INTEGER NOT NULL, PRIMARY KEY(user_id,day))`);
  return {
    query, close,
    async byName(name) { return (await query('SELECT * FROM app_users WHERE username=$1',[name]))[0]; },
    async byId(id) { return (await query('SELECT * FROM app_users WHERE id=$1',[id]))[0]; },
    async consume(id,limit) {
      const day=new Date().toISOString().slice(0,10);
      const rows=await query(`INSERT INTO app_usage(user_id,day,count) VALUES($1,$2,1)
        ON CONFLICT(user_id,day) DO UPDATE SET count=app_usage.count+1 WHERE app_usage.count < $3 RETURNING count`,[id,day,limit]);
      return rows.length > 0;
    }
  };
}
