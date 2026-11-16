import Link from 'next/link';
import { BRAND } from '@/lib/brand';

export const metadata = { title: `Account deleted · ${BRAND.product}` };

// Where Delete my account lands (docs/05 §1.1, docs/09 §12): the person is signed out and the sign-in is gone. Public:
// it shows nothing about the account.
export default function AccountDeletedPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1>{BRAND.product}</h1>
        <h2 className="text-heading-16" data-testid="account-deleted">
          Your account has been deleted.
        </h2>
        <p className="text-muted-foreground">
          You are signed out and can no longer sign in with that account. The records you made stay
          in their workspaces without your name.
        </p>
      </div>
      <p className="text-label-13">
        <Link className="text-info underline-offset-4 hover:underline" href="/login">
          Go to sign in
        </Link>
      </p>
    </div>
  );
}
