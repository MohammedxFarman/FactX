export const normalizedRoom = value => String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

// Compare rooms identically for manual entries and imported drafts, including
// older records that were saved with different spacing or letter case.
export function timetableConflict(db, row) {
  const room = normalizedRoom(row.room);
  return db.prepare('SELECT id,class_id,faculty_id,room FROM timetable WHERE day_of_week=? AND start_time<? AND end_time>?')
    .all(row.day_of_week, row.end_time, row.start_time)
    .find(other => other.class_id === row.class_id || other.faculty_id === row.faculty_id || room && normalizedRoom(other.room) === room);
}
