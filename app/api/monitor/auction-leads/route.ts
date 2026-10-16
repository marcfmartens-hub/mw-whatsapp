import { NextRequest, NextResponse } from 'next/server';
import { sessionUser } from '@/lib/monitorRole';
import { supabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

// Install at app/api/monitor/auction-leads/route.ts in Kaya.
// Existing staff session is required; the response contains only reception fields.
export async function GET(req: NextRequest) {
  const me = await sessionUser(req);
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { data: activeUser, error: userError } = await supabase
    .from('mw_monitor_users').select('username').eq('username', me.username).maybeSingle();
  if (userError || !activeUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const offset = Number(new URL(req.url).searchParams.get('offset') || 0);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000) {
    return NextResponse.json({ error: 'Invalid offset' }, { status: 400 });
  }
  const { data, error } = await supabase.from('mw_whatsapp')
    .select('id,phone,phone_number,name,make,model,year,mileage,specs,appointment,appointment_date,appointment_time,created_at')
    .order('created_at', { ascending: true }).range(offset, offset + 499);
  if (error) return NextResponse.json({ error: 'Lead read failed' }, { status: 502 });
  return NextResponse.json({ leads: data || [], nextOffset: data?.length === 500 ? offset + 500 : null },
    { headers: { 'Cache-Control': 'no-store' } });
}

