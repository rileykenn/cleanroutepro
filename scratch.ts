import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);

async function main() {
  const { data, error } = await supabase.from('clients').insert({
    org_id: 'a718c39e-953b-486a-8ff4-dc9469dd1c1e', // Assuming we have one
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
  console.log(error || data);
}
main();
