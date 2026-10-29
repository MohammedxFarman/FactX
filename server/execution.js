import { randomUUID } from 'node:crypto';
const encode = text => Buffer.from(text, 'utf8').toString('base64');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const languagePatterns = { python: /^Python \(3/, javascript: /^JavaScript \(Node/, c: /^C \(GCC/, cpp: /^C\+\+ \(GCC/, java: /^Java \(/ };

/** The worker only sends code to a separate Judge0 service. No shell or eval is used. */
export function startExecutionWorker(db) {
  if (!process.env.JUDGE_URL) return () => {};
  const base = process.env.JUDGE_URL.replace(/\/$/, '');
  let running = false, stopped = false;
  const headers = { 'Content-Type': 'application/json', ...(process.env.JUDGE_TOKEN ? { 'X-Auth-Token': process.env.JUDGE_TOKEN } : {}) };
  async function remote(route, options = {}) {
    const response = await fetch(base + route, { ...options, headers, redirect: 'error', signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`Sandbox request failed (${response.status})`);
    return response.json();
  }
  // Interrupted jobs are not silently re-executed after a restart.
  db.prepare("UPDATE submissions SET status='execution_error', feedback='Evaluation was interrupted. Contact faculty for review.' WHERE status='running'").run();
  const timer = setInterval(async () => {
    if (running || stopped) return;
    const job = db.prepare("SELECT s.*,a.config,a.max_marks FROM submissions s JOIN activities a ON a.id=s.activity_id WHERE s.status='queued' AND a.kind='lab' ORDER BY s.created_at LIMIT 1").get();
    if (!job) return;
    running = true;
    db.prepare("UPDATE submissions SET status='running' WHERE id=? AND status='queued'").run(job.id);
    try {
      const config = JSON.parse(job.config);
      const languages = await remote('/languages');
      const language = languages.filter(l => languagePatterns[config.language || 'python'].test(l.name)).at(-1);
      if (!language) throw new Error('Configured language is unavailable on this sandbox.');
      const testResults = [];
      for (const [index, test] of config.testCases.entries()) {
        if (stopped) throw new Error('Worker is stopping.');
        const submitted = await remote('/submissions?base64_encoded=true&wait=false', { method: 'POST', body: JSON.stringify({ source_code: encode(job.content), language_id: language.id, stdin: encode(test.input), expected_output: encode(test.output), cpu_time_limit: config.timeLimit || 2, wall_time_limit: Math.min((config.timeLimit || 2) * 3, 30), memory_limit: config.memoryLimit || 64000, max_file_size: 1024, enable_network: false }) });
        if (!submitted.token) throw new Error('Sandbox did not return a submission token.');
        let result;
        for (let poll = 0; poll < 40; poll++) {
          await sleep(750);
          result = await remote(`/submissions/${encodeURIComponent(submitted.token)}?base64_encoded=true&fields=status,time,memory`);
          if (result.status?.id > 2) break;
        }
        if (!result?.status || result.status.id <= 2 || result.status.id >= 13) throw new Error('Sandbox evaluation did not complete successfully.');
        // Do not persist hidden input/expected output or student-controlled stdout in public results.
        testResults.push({ test: index + 1, passed: result.status.id === 3, status: result.status.description, timeSeconds: result.time === null ? null : Number(result.time), memoryKB: result.memory });
      }
      const passed = testResults.filter(t => t.passed).length;
      const tasks=config.taskGrading?config.tasks.map((task,i)=>({title:task.title,max_marks:task.marks,score:config.testCases.every((t,j)=>t.task!==i||testResults[j].passed)?task.marks:0})):null;
      const score=tasks?tasks.reduce((n,t)=>n+t.score,0):passed/testResults.length*job.max_marks;
      db.prepare("UPDATE submissions SET status='evaluated',score=?,results=? WHERE id=?").run(score, JSON.stringify({ passed, total: testResults.length, tests: testResults, ...(tasks?{tasks}:{}) }), job.id);
      db.prepare('INSERT INTO notifications VALUES(?,?,?,?,NULL,?)').run(randomUUID(), job.student_id, 'Your programming assessment has been evaluated', `${passed} of ${testResults.length} test cases passed.`, new Date().toISOString());
      db.prepare('INSERT INTO assessment_events VALUES(?,?,?,?,?)').run(randomUUID(), job.student_id, job.activity_id, 'code.evaluated', new Date().toISOString());
    } catch (error) {
      console.error('Sandbox evaluation failed:', error.message);
      db.prepare("UPDATE submissions SET status='execution_error',feedback='The sandbox could not complete this evaluation. Contact faculty for review; no score has been assigned.' WHERE id=?").run(job.id);
    } finally { running = false; }
  }, 1000);
  timer.unref();
  return () => { stopped = true; clearInterval(timer); };
}
