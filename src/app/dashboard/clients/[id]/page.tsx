'use client';

import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import ClientProfileView from '@/components/ClientProfileView';

export default function ClientProfilePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { profile } = useAuth();
  const orgId = profile?.org_id || null;

  if (!orgId) return null;

  return (
    <ClientProfileView
      clientId={id}
      orgId={orgId}
      showBackButton
      onBack={() => router.push('/dashboard/clients')}
      onDelete={() => router.push('/dashboard/clients')}
    />
  );
}
