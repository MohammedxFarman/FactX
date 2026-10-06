const colors = ['#39765d','#6854ad','#b35530','#286caa','#ae4370','#7d7026'];
export function subjectColor(id:string) { let hash=0; for(const c of id)hash=(hash*31+c.charCodeAt(0))|0;return colors[Math.abs(hash)%colors.length]; }
export function dateLabel(value?:string|null) { return value?new Date(value).toLocaleDateString('en-IN',{day:'numeric',month:'short'}):'No deadline'; }
export function activityStatus(a:import('./types').Activity) { if(a.my_submission?.score!=null)return 'Graded';if(a.my_submission)return 'Submitted';if(a.config.startAt&&Date.parse(a.config.startAt)>Date.now())return 'Upcoming';if(a.deadline&&Date.parse(a.deadline)<Date.now())return 'Missed';return 'Live'; }
