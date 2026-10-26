export function summarizeResults(marks,grades) {
  const total=marks.reduce((sum,row)=>sum+row.score,0);
  const maximum=marks.reduce((sum,row)=>sum+row.max_marks,0);
  const credits=grades.reduce((sum,row)=>sum+row.credits,0);
  return {
    total:Number(total.toFixed(2)),maximum:Number(maximum.toFixed(2)),
    percentage:maximum?total/maximum*100:null,
    credits,gpa:credits?grades.reduce((sum,row)=>sum+row.grade_points*row.credits,0)/credits:null,
    semesters:[...new Set([...marks,...grades].map(row=>row.semester))].sort((a,b)=>a-b).map(semester=>{
      const ms=marks.filter(row=>row.semester===semester),gs=grades.filter(row=>row.semester===semester);
      const credit=gs.reduce((sum,row)=>sum+row.credits,0);
      return {semester,total:Number(ms.reduce((sum,row)=>sum+row.score,0).toFixed(2)),maximum:Number(ms.reduce((sum,row)=>sum+row.max_marks,0).toFixed(2)),gpa:credit?gs.reduce((sum,row)=>sum+row.grade_points*row.credits,0)/credit:null};
    }),
  };
}
