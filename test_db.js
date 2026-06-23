const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
const envStr = fs.readFileSync('.env.local', 'utf-8');
const url = envStr.match(/NEXT_PUBLIC_SUPABASE_URL=(.*)/)[1].trim();
const key = envStr.match(/SUPABASE_SERVICE_ROLE_KEY=(.*)/)[1].trim();
const supabase = createClient(url, key);

async function run() {
  const { data: staff } = await supabase.from('staff_members').select('*').ilike('name', '%Naz%');
  const { data: schedule } = await supabase.from('schedules').select('*').contains('staff_ids', [staff[0].id]).eq('schedule_date', '2026-06-15').single();
  console.log('has_start_base:', schedule.has_start_base);
  console.log('has_return_base:', schedule.has_return_base);
}
run();
