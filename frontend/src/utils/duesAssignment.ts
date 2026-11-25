export function parseDuesAmount(value:string):number|null {
 if(!/^\d+(\.\d{1,2})?$/.test(value)) return null;
 const [whole,fraction=""]=value.split(".");
 const cents=BigInt(whole)*100n+BigInt(fraction.padEnd(2,"0"));
 return cents<=BigInt(Number.MAX_SAFE_INTEGER)?Number(cents):null;
}
export function duesMoney(currency:string,value:string) {
 const cents=BigInt(value);
 return `${currency} ${(cents/100n).toLocaleString()}.${String(cents%100n).padStart(2,"0")}`;
}
