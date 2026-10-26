// CRM phone values use one international '+' prefix with digits only.
export function plusPhone(p: string | null | undefined): string {
  const digits=String(p??"").replace(/\D/g,"");
  return digits?`+${digits}`:"";
}
