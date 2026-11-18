'use client';

import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { EMAIL_LINK_EXPIRY } from '@/lib/auth-links';

/**
 * The Continue form of `/auth/confirm`: a plain POST to `/auth/callback` (it works without JavaScript too). A second
 * click while the first is on its way is ignored, so a double click never spends the token twice and lands on
 * "expired".
 */
export function ContinueForm({
  fields,
  button,
}: {
  fields: Record<string, string>;
  button: string;
}) {
  const sent = useRef(false);
  const [pending, setPending] = useState(false);
  return (
    <form
      method="post"
      action="/auth/callback"
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        if (sent.current) {
          e.preventDefault();
          return;
        }
        sent.current = true;
        setPending(true);
      }}
    >
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <Button
        type="submit"
        autoFocus
        aria-disabled={pending || undefined}
        className="w-full sm:w-fit"
        data-testid="email-link-continue"
      >
        {button}
      </Button>
      <p className="text-muted-foreground text-13 m-0">
        {`This link works once, for ${EMAIL_LINK_EXPIRY}.`}
      </p>
    </form>
  );
}
