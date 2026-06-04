require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

async function main() {
  const { data, error } = await supabase.from('clients').insert({
    org_id: 'fnmwktjpiftwheyfdguf', // fake org ID? wait I need a real org id. Or it doesn't matter, RLS will fail or it will just fail. Let's try.
    name: 'Test Client',
    address: '123 Test St',
    email: '',
    phone: '',
    default_duration_minutes: 90,
    default_staff_count: 1,
    notes: '',
    lat: null,
    lng: null,
    place_id: null,
    checklist_template_id: null,
    custom_checklist_items: null,
    color: null,
    rate: null
  }).select().single();
  console.log('Error:', error);
  console.log('Data:', data);
}
main();
