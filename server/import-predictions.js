import { readFileSync, existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import { openDatabase } from './db.js';

if(existsSync('.env')) loadEnvFile('.env');
const [filename, flag, approvedVersion] = process.argv.slice(2);
if(!filename || flag !== '--activate-reviewed-version' || !approvedVersion) throw new Error('Usage: node server/import-predictions.js file.json --activate-reviewed-version VERSION. This explicitly replaces the active model version.');
const contract = z.object({model:z.object({version:z.string().min(1),validated:z.literal(true),reviewed_by:z.string().min(1),reviewed_at:z.string().datetime({offset:true}),trained_at:z.string().datetime({offset:true}),dataset_reference:z.string().min(1),metrics:z.record(z.unknown()),features:z.array(z.string()).min(1)}),algorithm:z.literal('random_forest'),predictions:z.array(z.object({student_id:z.string().uuid(),probability:z.number().min(0).max(1),category:z.enum(['support_review','not_flagged']),factors:z.array(z.object({feature:z.string(),value:z.number().nullable(),contribution:z.number(),direction:z.string()})).min(1),created_at:z.string().datetime({offset:true})})).min(1)});
const payload=contract.parse(JSON.parse(readFileSync(filename,'utf8')));
if(payload.model.version!==approvedVersion)throw new Error('The named version does not match the reviewed artifact.');
const db=openDatabase(path.resolve(process.env.FACTX_DATA_DIR||'data'));
try{
  if(db.prepare('SELECT id FROM model_versions WHERE version=?').get(approvedVersion))throw new Error('This model version is already registered. Create a new version; do not overwrite it.');
  for(const p of payload.predictions)if(!db.prepare("SELECT id FROM users WHERE id=? AND role='STUDENT'").get(p.student_id))throw new Error(`Unknown student ID in predictions: ${p.student_id}`);
  const modelId=randomUUID();
  db.exec('BEGIN');
  try{
    db.prepare('UPDATE model_versions SET active=0').run();
    db.prepare('INSERT INTO model_versions VALUES(?,?,?,?,?,?,?,1,1)').run(modelId,approvedVersion,payload.algorithm,payload.model.dataset_reference,JSON.stringify(payload.model.metrics),JSON.stringify(payload.model.features),payload.model.trained_at);
    for(const p of payload.predictions)db.prepare('INSERT INTO risk_predictions VALUES(?,?,?,?,?,?,?)').run(randomUUID(),p.student_id,modelId,p.category,p.probability,JSON.stringify(p.factors),p.created_at);
    db.prepare('INSERT INTO audit_logs VALUES(?,NULL,?,?,?,?,?)').run(randomUUID(),'model.activated','model_versions',modelId,JSON.stringify({reviewed_by:payload.model.reviewed_by,reviewed_at:payload.model.reviewed_at,version:approvedVersion,predictions:payload.predictions.length}),new Date().toISOString());
    db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}
  console.log(`Activated reviewed model ${approvedVersion}; imported ${payload.predictions.length} predictions. Previous model versions are retained.`);
}finally{db.close();}
