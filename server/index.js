import { createApp } from './app.js';
import { loadRuntimeEnvironment } from './runtime-config.js';
import { startExecutionWorker } from './execution.js';
import { startWorkflowReminders } from './coordination.js';
import {startBackups} from './backups.js';
import path from 'node:path';
import { listen } from './listen.js';
loadRuntimeEnvironment();
const { app, db, setupToken, sendReminders }=createApp();
startExecutionWorker(db);
startWorkflowReminders(sendReminders);
startBackups(db,path.resolve(process.env.FACTX_DATA_DIR||'data'));
const host=process.env.HOST||'127.0.0.1',port=Number(process.env.PORT)||3001;
try {
  await listen(app,{host,port});
  console.log(`\nFactX server: http://${host}:${port}`);
  if(!db.prepare('SELECT id FROM users LIMIT 1').get())console.log(`First-run setup token: ${setupToken}\nCreate your administrator account in the browser. Keep this token private.\n`);
} catch(error) {
  console.error(error.code==='EADDRINUSE'?`Cannot start FactX: port ${port} on ${host} is already in use. Stop the existing server or choose a different PORT.`:`Cannot start FactX (${error.code||'startup failure'}).`);
  process.exitCode=1;
}
