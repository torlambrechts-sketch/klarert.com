// The auditor's "Start here" panel on Home (board review A10, docs/05 §4): where an auditor finds what an audit needs.
// Pure: the workspace slug and the adopted libraries in, the links out.

export type AuditorStartLink = {
  id: 'audit' | 'soa' | 'evidence' | 'activity';
  label: string;
  description: string;
  href: string;
};

export function auditorStartLinks(
  org: string,
  /** Live framework libraries (sheets with `is_library`), in menu order. */
  libraries: { sheetId: string; name: string }[],
): AuditorStartLink[] {
  const only = libraries.length === 1 ? libraries[0]! : null;
  return [
    {
      id: 'audit',
      label: 'Audit outputs',
      description: 'The statement of applicability, the audit pack and management review inputs.',
      href: `/${org}/audit`,
    },
    {
      id: 'soa',
      label: 'Statement of applicability',
      description: only
        ? `${only.name}: every requirement, whether it applies and why, with its evidence.`
        : libraries.length
          ? `Every requirement of the ${libraries.length} adopted frameworks, whether it applies and why.`
          : 'Every requirement of an adopted framework, whether it applies and why.',
      // one library: straight to it; several or none: the list on Audit outputs
      href: only ? `/${org}/audit/soa/${only.sheetId}` : `/${org}/audit#audit-soa`,
    },
    {
      id: 'evidence',
      label: 'Evidence library',
      description: 'The current version of every file, with whether it is still valid.',
      href: `/${org}/evidence`,
    },
    {
      id: 'activity',
      label: 'Activity log',
      description:
        'The log of a period, with every hash chain checked, is in the audit pack. Each item’s log is on its Activity tab.',
      href: `/${org}/audit#audit-pack`,
    },
  ];
}
