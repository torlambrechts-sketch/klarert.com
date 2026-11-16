import { legalMetadata, LegalPageView } from '@/components/landing/legal-page';
import { PRIVACY, TERMS } from '@/components/landing/legal';

// Draft terms (owner decision, 16 Nov 2026): static, indexed, linked from the footer and the sign-up form.
export const dynamic = 'force-static';
export const metadata = legalMetadata(TERMS);

export default function TermsPage() {
  return <LegalPageView page={TERMS} other={PRIVACY} />;
}
