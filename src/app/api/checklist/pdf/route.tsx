import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { renderToBuffer, Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';

// Server-side Supabase client using service role (read-only — no user context needed for PDF)
function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

// ─── PDF Styles ───────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  page: { padding: 40, fontFamily: 'Helvetica', backgroundColor: '#ffffff', fontSize: 10 },
  header: { marginBottom: 24, paddingBottom: 16, borderBottomWidth: 2, borderBottomColor: '#4F46E5' },
  headerTitle: { fontSize: 20, fontFamily: 'Helvetica-Bold', color: '#111827', marginBottom: 4 },
  headerMeta: { fontSize: 9, color: '#6B7280' },
  badge: { fontSize: 9, color: '#4F46E5', marginBottom: 6, fontFamily: 'Helvetica-Bold' },
  prefillRow: { flexDirection: 'row', gap: 16, marginBottom: 16, backgroundColor: '#EEF2FF', padding: 8, borderRadius: 6 },
  prefillItem: { fontSize: 9, color: '#3730A3' },
  sectionTitle: { fontSize: 12, fontFamily: 'Helvetica-Bold', color: '#374151', marginBottom: 8, marginTop: 16, paddingBottom: 4, borderBottomWidth: 1, borderBottomColor: '#E5E7EB' },
  sectionDesc: { fontSize: 9, color: '#6B7280', marginBottom: 8 },
  fieldContainer: { marginBottom: 12, padding: 10, backgroundColor: '#F9FAFB', borderRadius: 6, borderWidth: 1, borderColor: '#E5E7EB' },
  fieldLabel: { fontSize: 10, fontFamily: 'Helvetica-Bold', color: '#111827', marginBottom: 4 },
  fieldDesc: { fontSize: 9, color: '#6B7280', marginBottom: 4 },
  fieldValue: { fontSize: 10, color: '#374151', padding: 6, backgroundColor: '#ffffff', borderRadius: 4, borderWidth: 1, borderColor: '#D1D5DB', minHeight: 20 },
  fieldValueNA: { fontSize: 10, color: '#9CA3AF', fontFamily: 'Helvetica-Oblique' },
  required: { color: '#EF4444', fontFamily: 'Helvetica-Bold' },
  footer: { position: 'absolute', bottom: 24, left: 40, right: 40, textAlign: 'center', fontSize: 8, color: '#9CA3AF', borderTopWidth: 1, borderTopColor: '#E5E7EB', paddingTop: 8 },
  submittedBanner: { backgroundColor: '#ECFDF5', padding: 8, borderRadius: 6, marginBottom: 16, borderWidth: 1, borderColor: '#A7F3D0' },
  submittedText: { color: '#065F46', fontFamily: 'Helvetica-Bold', fontSize: 10, textAlign: 'center' },
});

function formatValue(value: unknown, type: string): string {
  if (value === null || value === undefined || value === '') return '—';
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (type === 'yesno') return value === 'yes' ? '✓ Yes' : '✗ No';
  if (type === 'checkbox') return value ? '☑ Completed' : '☐ Not completed';
  return String(value);
}

// ─── Route handler ────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const completionId = req.nextUrl.searchParams.get('completion_id');
  if (!completionId) return NextResponse.json({ error: 'completion_id required' }, { status: 400 });

  const supabase = getSupabase();

  // Fetch completion
  const { data: completion, error: compErr } = await supabase
    .from('checklist_completions')
    .select('*, checklist_id, client_id, status, submitted_at, pre_fill, items, notes')
    .eq('id', completionId)
    .single();

  if (compErr || !completion) {
    return NextResponse.json({ error: 'Completion not found' }, { status: 404 });
  }

  // Fetch checklist template
  let checklistName = 'Checklist';
  let sections: { id: string; title: string; description?: string; fields: { id: string; type: string; label: string; description?: string; required?: boolean }[] }[] = [];

  if (completion.checklist_id) {
    const { data: cl } = await supabase
      .from('client_checklists')
      .select('name, sections')
      .eq('id', completion.checklist_id)
      .single() as { data: { name: string; sections: typeof sections } | null };
    if (cl) {
      checklistName = cl.name;
      sections = (cl.sections || []).map((s: Record<string, unknown>) => ({
        id: s.id as string,
        title: s.title as string,
        description: s.description as string | undefined,
        fields: ((s.fields || s.items || []) as Record<string, unknown>[]).map(f => ({
          id: f.id as string,
          type: (f.type || 'checkbox') as string,
          label: (f.label || f.text || '') as string,
          description: f.description as string | undefined,
          required: f.required as boolean | undefined,
        })),
      }));
    }
  }

  // Fetch client name
  const { data: clientData } = await supabase
    .from('clients')
    .select('name, address')
    .eq('id', completion.client_id)
    .single() as { data: { name: string; address: string } | null };

  const clientName = clientData?.name || 'Client';
  const clientAddress = clientData?.address || '';

  const preFill = completion.pre_fill as { date?: string; time?: string; staff_name?: string; client_name?: string } | null;
  const items = (completion.items || []) as { field_id: string; value: unknown; na: boolean }[];
  const isSubmitted = completion.status === 'submitted';

  const submittedAt = completion.submitted_at
    ? new Date(completion.submitted_at).toLocaleString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : null;

  // ─── Build PDF document ─────────────────────────────────────────────────────
  const doc = (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.badge}>CLEANROUTE PRO — JOB REPORT</Text>
          <Text style={styles.headerTitle}>{checklistName}</Text>
          <Text style={styles.headerMeta}>{clientName}  ·  {clientAddress}</Text>
          {submittedAt && <Text style={styles.headerMeta}>Submitted: {submittedAt}</Text>}
        </View>

        {/* Submitted banner */}
        {isSubmitted && (
          <View style={styles.submittedBanner}>
            <Text style={styles.submittedText}>✓  Form submitted and locked</Text>
          </View>
        )}

        {/* Pre-fill metadata */}
        {preFill && (
          <View style={styles.prefillRow}>
            {preFill.date && <Text style={styles.prefillItem}>Date: {preFill.date}</Text>}
            {preFill.time && <Text style={styles.prefillItem}>Time: {preFill.time}</Text>}
            {preFill.staff_name && <Text style={styles.prefillItem}>Staff: {preFill.staff_name}</Text>}
          </View>
        )}

        {/* Sections & Fields */}
        {sections.map(sec => (
          <View key={sec.id}>
            <Text style={styles.sectionTitle}>{sec.title}</Text>
            {sec.description && <Text style={styles.sectionDesc}>{sec.description}</Text>}
            {sec.fields.map(field => {
              const resp = items.find(r => r.field_id === field.id);
              return (
                <View key={field.id} style={styles.fieldContainer}>
                  <Text style={styles.fieldLabel}>
                    {field.label}{field.required ? <Text style={styles.required}> *</Text> : ''}
                  </Text>
                  {field.description && <Text style={styles.fieldDesc}>{field.description}</Text>}
                  {resp?.na
                    ? <Text style={styles.fieldValueNA}>Not Applicable</Text>
                    : <Text style={styles.fieldValue}>{formatValue(resp?.value ?? null, field.type)}</Text>
                  }
                </View>
              );
            })}
          </View>
        ))}

        {/* Notes */}
        {completion.notes && (
          <View style={{ marginTop: 16 }}>
            <Text style={styles.sectionTitle}>Notes</Text>
            <Text style={{ fontSize: 10, color: '#374151' }}>{completion.notes}</Text>
          </View>
        )}

        {/* Footer */}
        <Text style={styles.footer} fixed>
          {clientName}  ·  {checklistName}  ·  Generated by CleanRoute Pro
        </Text>
      </Page>
    </Document>
  );

  const buffer = await renderToBuffer(doc);

  const filename = `${clientName.replace(/[^a-z0-9]/gi, '_')}_${checklistName.replace(/[^a-z0-9]/gi, '_')}.pdf`;

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
