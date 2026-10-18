// Persist inbound messages before any fallible external work. An assistant reply is
// recorded by the caller only after its send succeeds.
export async function saveInbound<T extends { last_msg_id?: string | null; messages?: any[] | null }>(
  phone: string, id: string, content: string,
  read: (phone: string) => Promise<T>,
  write: (phone: string, updates: any) => Promise<unknown>,
): Promise<{ duplicate: boolean; before: T }> {
  const before = await read(phone);
  if (before.last_msg_id === id) return { duplicate: true, before };
  await write(phone, {
    phone_number: phone,
    last_msg_id: id,
    last_message_at: new Date().toISOString(),
    messages: [...(Array.isArray(before.messages) ? before.messages : []), { role: "user", content }].slice(-40),
  });
  return { duplicate: false, before };
}
