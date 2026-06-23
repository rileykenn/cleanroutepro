const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
const envStr = fs.readFileSync('.env.local', 'utf-8');
const url = envStr.match(/NEXT_PUBLIC_SUPABASE_URL=(.*)/)[1].trim();
const key = envStr.match(/SUPABASE_SERVICE_ROLE_KEY=(.*)/)[1].trim();
const supabase = createClient(url, key);

async function run() {
  const { data: qData, error: qErr } = await supabase.from('template_schedules').select('*').limit(1);
  if (qData && qData.length > 0) {
    console.log(Object.keys(qData[0]));
  }
}
run();
