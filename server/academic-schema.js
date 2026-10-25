export function migrateAcademics(db){
 db.exec(`
 CREATE TABLE IF NOT EXISTS programs(id TEXT PRIMARY KEY,code TEXT UNIQUE NOT NULL,name TEXT UNIQUE NOT NULL,duration INTEGER CHECK(duration BETWEEN 1 AND 10),roll_rule TEXT NOT NULL DEFAULT '',email_domain TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'configuration_required' CHECK(status IN ('active','configuration_required')));
 CREATE TABLE IF NOT EXISTS program_departments(department_id TEXT PRIMARY KEY REFERENCES departments(id),program_id TEXT NOT NULL REFERENCES programs(id),hod_id TEXT REFERENCES users(id));
 CREATE TABLE IF NOT EXISTS admission_batches(id TEXT PRIMARY KEY,program_id TEXT NOT NULL REFERENCES programs(id),department_id TEXT NOT NULL REFERENCES departments(id),admission_year INTEGER NOT NULL CHECK(admission_year BETWEEN 1900 AND 2200),current_year INTEGER NOT NULL CHECK(current_year BETWEEN 1 AND 10),status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','graduated','archived')),UNIQUE(program_id,department_id,admission_year));
 CREATE TABLE IF NOT EXISTS academic_sections(class_id TEXT PRIMARY KEY REFERENCES classes(id),batch_id TEXT NOT NULL REFERENCES admission_batches(id),academic_year INTEGER NOT NULL CHECK(academic_year BETWEEN 1 AND 10),section TEXT NOT NULL,class_teacher_id TEXT REFERENCES users(id),UNIQUE(batch_id,academic_year,section));
 CREATE TABLE IF NOT EXISTS faculty_programs(user_id TEXT NOT NULL REFERENCES users(id),program_id TEXT NOT NULL REFERENCES programs(id),department_id TEXT NOT NULL REFERENCES departments(id),PRIMARY KEY(user_id,program_id,department_id));
 CREATE TABLE IF NOT EXISTS academic_test_accounts(user_id TEXT PRIMARY KEY REFERENCES users(id),seed TEXT NOT NULL,created_at TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS idx_batches_program_department ON admission_batches(program_id,department_id,admission_year);
 CREATE INDEX IF NOT EXISTS idx_sections_batch ON academic_sections(batch_id);
 CREATE INDEX IF NOT EXISTS idx_users_role_name ON users(role,name);
 CREATE INDEX IF NOT EXISTS idx_sections_teacher ON academic_sections(class_teacher_id);
 CREATE TRIGGER IF NOT EXISTS academic_staff_auto_assign AFTER INSERT ON users WHEN NEW.role IN ('FACULTY','HOD') BEGIN
 INSERT OR IGNORE INTO faculty_programs(user_id,program_id,department_id) SELECT NEW.id,program_id,department_id FROM program_departments WHERE department_id=NEW.department_id;
 END;
 CREATE TRIGGER IF NOT EXISTS academic_student_department_insert BEFORE INSERT ON users WHEN NEW.role='STUDENT' BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM academic_sections s JOIN classes c ON c.id=s.class_id WHERE s.class_id=NEW.class_id AND c.department_id<>NEW.department_id) THEN RAISE(ABORT,'Student department must match the section') END;
 END;
 CREATE TRIGGER IF NOT EXISTS academic_student_department_update BEFORE UPDATE OF class_id,department_id ON users WHEN NEW.role='STUDENT' BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM academic_sections s JOIN classes c ON c.id=s.class_id WHERE s.class_id=NEW.class_id AND c.department_id<>NEW.department_id) THEN RAISE(ABORT,'Student department must match the section') END;
 END;
 CREATE TRIGGER IF NOT EXISTS academic_staff_role_guard BEFORE UPDATE OF role,department_id,active ON users WHEN NEW.role<>'FACULTY' OR NEW.department_id<>OLD.department_id OR NEW.active=0 BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM academic_sections WHERE class_teacher_id=OLD.id) THEN RAISE(ABORT,'Reassign class teacher responsibilities before changing this account') END;
 END;
 CREATE TRIGGER IF NOT EXISTS academic_hod_role_guard BEFORE UPDATE OF role,department_id,active ON users WHEN NEW.role<>'HOD' OR NEW.department_id<>OLD.department_id OR NEW.active=0 BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM program_departments WHERE hod_id=OLD.id) THEN RAISE(ABORT,'Reassign HOD responsibilities before changing this account') END;
 END;
 CREATE TRIGGER IF NOT EXISTS academic_batch_guard BEFORE INSERT ON admission_batches BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM program_departments WHERE department_id=NEW.department_id AND program_id=NEW.program_id) THEN RAISE(ABORT,'Batch department must belong to its program') END;
 END;
 CREATE TRIGGER IF NOT EXISTS academic_section_guard BEFORE INSERT ON academic_sections BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM classes c JOIN admission_batches b ON b.id=NEW.batch_id JOIN programs p ON p.id=b.program_id WHERE c.id=NEW.class_id AND c.department_id=b.department_id AND NEW.academic_year<=p.duration) THEN RAISE(ABORT,'Section program or year mismatch') END;
 END;
 CREATE TRIGGER IF NOT EXISTS academic_teacher_insert BEFORE INSERT ON academic_sections WHEN NEW.class_teacher_id IS NOT NULL BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM users u JOIN faculty_programs f ON f.user_id=u.id JOIN admission_batches b ON b.id=NEW.batch_id WHERE u.id=NEW.class_teacher_id AND u.role='FACULTY' AND u.active=1 AND f.program_id=b.program_id AND f.department_id=b.department_id) THEN RAISE(ABORT,'Class teacher must be assigned to the program and department') END;
 END;
 CREATE TRIGGER IF NOT EXISTS academic_teacher_update BEFORE UPDATE OF class_teacher_id ON academic_sections WHEN NEW.class_teacher_id IS NOT NULL BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM users u JOIN faculty_programs f ON f.user_id=u.id JOIN admission_batches b ON b.id=NEW.batch_id WHERE u.id=NEW.class_teacher_id AND u.role='FACULTY' AND u.active=1 AND f.program_id=b.program_id AND f.department_id=b.department_id) THEN RAISE(ABORT,'Class teacher must be assigned to the program and department') END;
 END;
 `);
}

// Shared SQL authorization for paged lists and accurate counts. Values are bound.
export function studentScope(user,alias='u'){
 if(user.role==='ADMIN')return {sql:'1=1',params:[]};
 if(user.role==='HOD')return {sql:`${alias}.department_id=?`,params:[user.department_id]};
 if(user.role==='STUDENT')return {sql:`${alias}.id=?`,params:[user.id]};
 return {sql:`(${alias}.class_id IN (SELECT class_id FROM teaching_assignments WHERE faculty_id=?) OR ${alias}.class_id IN (SELECT class_id FROM academic_sections WHERE class_teacher_id=?))`,params:[user.id,user.id]};
}

export function academicCounts(db,programId){
 const count=(sql,...args)=>db.prepare(sql).get(...args).n;
 return {
 departments:count('SELECT count(*) n FROM program_departments WHERE program_id=?',programId),
 hods:count("SELECT count(DISTINCT u.id) n FROM users u JOIN program_departments pd ON pd.hod_id=u.id WHERE pd.program_id=? AND u.role='HOD'",programId),
 faculty:count("SELECT count(DISTINCT u.id) n FROM users u JOIN faculty_programs f ON f.user_id=u.id WHERE f.program_id=? AND u.role='FACULTY'",programId),
 batches:count('SELECT count(*) n FROM admission_batches WHERE program_id=?',programId),
 academicYears:count('SELECT count(DISTINCT current_year) n FROM admission_batches WHERE program_id=?',programId),
 sections:count('SELECT count(*) n FROM academic_sections s JOIN admission_batches b ON b.id=s.batch_id WHERE b.program_id=?',programId),
 students:count("SELECT count(*) n FROM users u JOIN academic_sections s ON s.class_id=u.class_id JOIN admission_batches b ON b.id=s.batch_id WHERE b.program_id=? AND u.role='STUDENT'",programId),
 classTeachers:count('SELECT count(*) n FROM academic_sections s JOIN admission_batches b ON b.id=s.batch_id WHERE b.program_id=? AND s.class_teacher_id IS NOT NULL',programId),
 };
}
