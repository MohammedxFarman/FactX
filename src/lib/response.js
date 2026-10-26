/** @param {Response} response */
export async function readApiResponse(response){
  const raw=await response.text();
  let data;
  try{data=raw?JSON.parse(raw):null;}
  catch{throw Object.assign(new Error(response.status>=500?'The API server is unavailable. Check that the backend is running and the proxy points to its port.':'The API returned an invalid JSON response. Please contact your administrator.'),{status:response.status});}
  if(!response.ok)throw Object.assign(new Error(data?.error||`Request failed (${response.status}).`),{status:response.status,details:data});
  if(!raw.trim()&&response.status!==204)throw new Error('The API returned an empty response. Please contact your administrator.');
  return data;
}
