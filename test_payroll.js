const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
const envStr = fs.readFileSync('.env.local', 'utf-8');
const url = envStr.match(/NEXT_PUBLIC_SUPABASE_URL=(.*)/)[1].trim();
const key = envStr.match(/SUPABASE_SERVICE_ROLE_KEY=(.*)/)[1].trim();
const supabase = createClient(url, key);

async function run() {
  const { data: schedules } = await supabase.from('schedules').select('id, staff_ids').limit(1);
  console.log(typeof schedules[0].staff_ids, Array.isArray(schedules[0].staff_ids));
}
run();
