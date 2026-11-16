import { legalMetadata, LegalPageView } from '@/components/landing/legal-page';
import { PRIVACY, TERMS } from '@/components/landing/legal';

// Draft privacy notice (owner decision, 16 Nov 2026): static, indexed, linked from the footer and the sign-up form.
export const dynamic = 'force-static';
export const metadata = legalMetadata(PRIVACY);

export default function PrivacyPage() {
  return <LegalPageView page={PRIVACY} other={TERMS} />;
}
