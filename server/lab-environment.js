export const notebookByteLimit = 10 * 1024 * 1024;

export function isMlSubject(activity) {
  return [activity.subject_name, activity.title].some(name =>
    /\b(?:machine[\s-]*learning|ml(?:[\s-]*lab(?:oratory)?)?|data science|deep learning)\b/i.test(name || '')
  );
}

export function isNotebookLab(activity, config) {
  if (config.secureMode || (config.language && config.language !== 'python')) return false;
  if (config.workspace === 'notebook') return true;
  if (config.workspace === 'code') return false;
  return isMlSubject(activity);
}

export function isNotebook(content) {
  try {
    const file = JSON.parse(content);
    return file?.nbformat === 4 && Array.isArray(file.cells) && file.cells.length > 0 &&
      file.cells.every(cell => cell && ['code', 'markdown', 'raw'].includes(cell.cell_type) &&
        (typeof cell.source === 'string' || (Array.isArray(cell.source) && cell.source.every(line => typeof line === 'string'))));
  } catch { return false; }
}
