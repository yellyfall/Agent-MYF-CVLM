const fs=require('node:fs');const path=require('node:path');const {DatabaseSync}=require('node:sqlite');
module.exports=function migrate(db,dir){
 if(db.prepare("SELECT value FROM config WHERE key='migration_v2_users'").get())return 0;
 const file=path.join(dir,'candidature.db');if(!fs.existsSync(file))return 0;
 const source=new DatabaseSync(file,{readOnly:true});let count=0;
 try{
  if(!source.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='app_users'").get())return 0;
  const rows=source.prepare("SELECT * FROM app_users WHERE role='user'").all();
  const insert=db.prepare('INSERT OR IGNORE INTO users(id,username,password,fullname,status,expires_at,created_at) VALUES(?,?,?,?,?,?,?)');
  db.exec('BEGIN');
  try{for(const u of rows)count+=Number(insert.run(u.id,u.username,u.password,u.fullname,u.status,u.expires_at,u.created_at).changes);db.prepare("INSERT INTO config(key,value) VALUES('migration_v2_users','done')").run();db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
  return count;
 }finally{source.close();}
};
