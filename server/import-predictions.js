import { readFileSync, existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import path from 'node:path';
import { openDatabase } from './db.js';
import { importRiskPredictions } from './risk-models.js';

if (existsSync('.env')) loadEnvFile('.env');
const [filename, flag, approvedVersion] = process.argv.slice(2);
if (!filename || flag !== '--activate-reviewed-version' || !approvedVersion) throw new Error('Usage: node server/import-predictions.js file.json --activate-reviewed-version VERSION');
const databaseDir = path.resolve(process.env.FACTX_DATA_DIR || 'data');
const db = openDatabase(databaseDir);
try {
  const result = importRiskPredictions(db, JSON.parse(readFileSync(filename, 'utf8')), approvedVersion);
  console.log(`Activated reviewed model ${result.version} for ${result.target}; inserted ${result.inserted} new predictions and retained prior versions.`);
} finally {
  db.close();
}
