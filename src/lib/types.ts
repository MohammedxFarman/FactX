import type { ComponentType, ReactNode } from 'react';
export type Role = 'ADMIN' | 'HOD' | 'FACULTY' | 'STUDENT';
export interface User { id:string; name:string; role:Role; class_id?:string; roll_number?:string }
export interface Subject { id:string; name:string; code?:string; department_id?:string }
export interface SchoolClass extends Subject { semester:number }
export interface Catalog { subjects:Subject[]; classes:SchoolClass[]; teachingAssignments: {class_id:string;subject_id:string;faculty_id:string}[] }
export interface Submission { id:string; student_name?:string; content:string; score:number|null; status:string; attempt:number; created_at:string; feedback?:string; results?:{passed?:number;total?:number;tasks?:{title:string;score:number;max_marks:number}[];tests?:{test:number;passed:boolean;status:string}[]} }
export interface Activity { id:string; kind:string; title:string; description:string; subject_id:string; subject_name:string; class_id:string; class_name:string; created_at:string; deadline:string|null; max_marks:number; submission_count:number; my_submission?:Submission; config:{studio?:boolean;tasks?:{title:string;instructions:string;criteria:string;marks:number}[];language?:string;resourceUrl?:string;materialType?:string;week?:number;secureMode?:boolean;sampleTests?:{input:string;output:string}[];startAt?:string;durationMinutes?:number;attempts?:number} }
export interface Session { id:string;subject_id:string;subject_name:string;class_id:string;class_name:string;faculty_id:string;faculty_name:string;day_of_week:number;start_time:string;end_time:string;room:string }
export interface Attendance { id:string;student_id:string;student_name:string;subject_id:string;subject_name:string;class_id:string;date:string;period:number;status:string }
export interface Dashboard { attendance:number|null;average:number|null;students:number;classes:number;assessments:number;pendingEvaluations:number;validatedPredictions:number;trend:{month:string;value:number}[];upcoming:Activity[];attention:{id:string;name:string;suggestions:{title:string;detail:string;source:string}[]}[] }
export interface Api { <T=unknown>(url:string,options?:{method?:string;body?:unknown;signal?:AbortSignal}):Promise<T> }
export interface PageProps<T> { data:T;user:User;catalog:Catalog;api:Api;navigate:(page:string,target?:unknown)=>void;openActivity:(activity:Activity)=>void;onAction:()=>void;refresh:()=>Promise<void>; target?:{subject_id?:string}; children?:ReactNode }
export type Icon = ComponentType<{size?:number;className?:string}>;
