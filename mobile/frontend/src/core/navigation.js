/** Logical parents are used only when there is no usable in-app history. */
export function backTarget(snapshot){
 const name=snapshot.route.name,authenticated=Boolean(snapshot.tokens&&snapshot.user);
 if(!authenticated)return name==="forgotPassword"?"login":name==="login"||name==="signup"?"welcome":null;
 const owner=snapshot.user.role==="OWNER",home=owner?"ownerHome":snapshot.user.role==="STUDENT"?"studentHome":"workspaces";
 const parents={residentRequest:"residentRequests",residentRentSetup:"residentRequests",resident:"residents",residentEdit:"residents",residentRequests:"residents",room:"rooms",roomForm:"rooms",setupProperty:"workspaces",subscription:"workspaces",planVerification:"subscription",planSuccess:"subscription",rentVerification:"invoices",rentSuccess:"invoices",joinStatus:"workspaces",joinWorkspace:"workspaces",workspaces:owner?"subscription":snapshot.user.role==="STUDENT"?"studentHome":null,setupProfile:"workspaces",chooseRole:"workspaces",legal:"workspaces",properties:home};
 return name===home?null:parents[name]===undefined?home:parents[name];
}
