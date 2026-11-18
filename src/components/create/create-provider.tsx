'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { CreateRefusedDialog } from './create-refused';
import { CreateWizard, type CardId } from './create-wizard';

// The one way to create things (docs/05 §4 Create): the side menu's Create button, the phone menu, Ctrl/Cmd+K and every
// empty state open the same picker, optionally at a card and a folder ("New sheet here"). Create is for editors, admins
// and owners (owner decision 15 Nov 2026): viewers and auditors get no button and no shortcut, and if they reach
// Create anyway it refuses with a way back to Home.

export interface CreateRequest {
  card?: CardId;
  /** "New sheet here": the folder the sheet goes into. */
  folderId?: string | null;
  goal?: string;
}

type Ctx = { openCreate: (r?: CreateRequest) => void; canEdit: boolean };
const CreateContext = createContext<Ctx | null>(null);

export function CreateProvider({
  org,
  canEdit,
  children,
}: {
  org: string;
  canEdit: boolean;
  children: React.ReactNode;
}) {
  const [request, setRequest] = useState<CreateRequest | null>(null);
  const openCreate = useCallback((r: CreateRequest = {}) => setRequest(r), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!canEdit) return;
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== 'k')
        return;
      if (document.querySelector('[role="dialog"]')) return;
      e.preventDefault();
      setRequest({});
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [canEdit]);
  const value = useMemo(() => ({ openCreate, canEdit }), [openCreate, canEdit]);
  return (
    <CreateContext.Provider value={value}>
      {children}
      {!request ? null : canEdit ? (
        <CreateWizard org={org} request={request} onClose={() => setRequest(null)} />
      ) : (
        <CreateRefusedDialog org={org} onClose={() => setRequest(null)} />
      )}
    </CreateContext.Provider>
  );
}

/** Outside the workspace shell (no provider) the hook returns null and callers fall back to links. */
export function useCreate(): Ctx | null {
  return useContext(CreateContext);
}

/**
 * "New sheet" and "New sheet here" everywhere: a link to the wizard page (so it still works opened in a new tab) that
 * opens Create at the Sheet card in place.
 */
export function CreateSheetLink({
  org,
  folderId,
  onNavigate,
  onClick,
  children,
  ...rest
}: Omit<React.ComponentProps<typeof Link>, 'href'> & {
  org: string;
  folderId?: string | null;
  onNavigate?: () => void;
}) {
  const create = useCreate();
  return (
    // the rest carries a menu item's role, ref and handlers when it sits inside a menu (asChild)
    <Link
      {...rest}
      href={folderId ? `/${org}/s/new?folder=${folderId}` : `/${org}/s/new`}
      onClick={(e) => {
        onClick?.(e);
        onNavigate?.();
        if (!create || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        create.openCreate({ card: 'sheet', folderId: folderId ?? null });
      }}
    >
      {children}
    </Link>
  );
}

/** The side menu's Create button (also in the phone menu): editors, admins and owners only. */
export function CreateButton({ onOpen, className }: { onOpen?: () => void; className?: string }) {
  const create = useCreate();
  if (!create?.canEdit) return null;
  return (
    <button
      type="button"
      data-testid="create-button"
      onClick={() => {
        onOpen?.();
        create.openCreate();
      }}
      title="Create (Ctrl+K)"
      className={cn(
        'bg-brand text-primary-foreground text-body hover:bg-navy flex h-11 w-full shrink-0 items-center gap-2.5 rounded-full px-5 font-semibold transition-colors duration-150 active:scale-[0.98]',
        className,
      )}
    >
      <Plus className="size-4 shrink-0" aria-hidden />
      <span data-side-text className="min-w-0 flex-1 truncate text-left">
        Create
      </span>
      <kbd
        data-side-text
        aria-hidden
        className="text-label-11-mono rounded-[4px] border border-white/25 px-[5px] leading-[18px] opacity-80"
      >
        Ctrl K
      </kbd>
    </button>
  );
}
