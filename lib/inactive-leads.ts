import { reconcileBigin } from "./bigin-reconcile";
// One worker handles explicit outcomes immediately on retry and incomplete leads
// after 15 minutes. It sends no WhatsApp messages and never invents an appointment.
export async function pushInactive(_recoveryOnly=false){return reconcileBigin();}
