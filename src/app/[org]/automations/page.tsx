import { AutomationsScreen } from '@/components/automations/automations-screen';
import { requireMember } from '@/server/auth';
import { BRAND } from '@/lib/brand';

export const metadata = { title: `Automations · ${BRAND.product}` };

// Automations (docs/04 §10): every automation of the workspace or one sheet's, the builder, recipes and the run log
// (?tab=runs). The client screen reads under the person's RLS and writes through the automation commands.
export default async function AutomationsPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const { workspace, role, user } = await requireMember(org);
  return (
    <AutomationsScreen
      org={org}
      orgId={workspace.id}
      role={role}
      timeZone={workspace.time_zone}
      userId={user.id}
    />
  );
}
