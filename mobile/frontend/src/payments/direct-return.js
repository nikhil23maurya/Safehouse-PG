// Only account-scoped payment references, never credentials or payment success.
let preview=[];
function identity(s){return {accountId:s.platform?.account?.id,membershipId:s.platform?.membershipId};}
function read(native){try{const rows=JSON.parse(native.call("getDirectTransferState")||"null");return Array.isArray(rows)?rows:preview;}catch{return preview;}}
export function pendingDirect(s,native){const key=identity(s);return read(native).find(v=>v.accountId===key.accountId&&v.membershipId===key.membershipId&&/^[A-Za-z0-9_-]{1,100}$/.test(v.transferId||"")&&/^[A-Za-z0-9_-]{1,100}$/.test(v.invoiceId||""))||null;}
export function saveDirect(s,native,value){
 const key=identity(s);if(!key.accountId||!key.membershipId)throw new Error("Select your residency first.");
 const rows=read(native).filter(v=>v.accountId!==key.accountId||v.membershipId!==key.membershipId);
 if(value)rows.push({...key,transferId:value.transferId,invoiceId:value.invoiceId,stage:value.stage||"READY"});
 preview=rows.slice(-20);
 if(native.has("saveDirectTransferState")&&native.call("saveDirectTransferState",JSON.stringify(preview))!==true)throw new Error("Payment recovery could not be saved. Restart PGOne before paying.");
}
