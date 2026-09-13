export function splitEqual(cents, members) {
  if (!Number.isSafeInteger(cents) || cents <= 0 || !members.length) throw new Error('請輸入有效金額並選擇分帳成員');
  return Object.fromEntries(members.map((m,i)=>[m,Math.floor(cents/members.length)+(i<cents%members.length?1:0)]));
}
export function balances(trip) {
  const result=Object.fromEntries(trip.members.map(m=>[m,0]));
  trip.expenses.forEach(e=>{result[e.payer]+=e.cents;Object.entries(e.shares).forEach(([m,n])=>result[m]-=n)});
  return result;
}
export function settlements(trip) {
  const b=balances(trip), debt=Object.entries(b).filter(([,n])=>n<0).map(([m,n])=>[m,-n]), credit=Object.entries(b).filter(([,n])=>n>0).map(x=>[...x]);
  const result=[];let i=0,j=0;
  while(i<debt.length&&j<credit.length){const n=Math.min(debt[i][1],credit[j][1]);result.push({from:debt[i][0],to:credit[j][0],cents:n});debt[i][1]-=n;credit[j][1]-=n;if(!debt[i][1])i++;if(!credit[j][1])j++}
  return result;
}
