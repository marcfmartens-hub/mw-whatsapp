import { reconcileBigin } from "./bigin-reconcile";
import { reconcileConsole } from "./console-crm-reconcile";
export async function pushInactive(_recoveryOnly=false){
 let bigin;try{bigin=await reconcileBigin();}catch{bigin={error:'Bigin recovery failed'};}
 let consoleCrm;try{consoleCrm=await reconcileConsole();}catch{consoleCrm={error:'Console CRM recovery failed'};}
 return {...bigin,consoleCrm};
}

