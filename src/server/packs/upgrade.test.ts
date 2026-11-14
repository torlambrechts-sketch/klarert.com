import { describe, expect, it } from 'vitest';
import { updateTarget, updatesFor } from './upgrade';

// docs/11 Upgrades: an install updates to the newest version of its own major; a new major version (a pack rebuilt as
// an add-on to the Core registers) is installed fresh, never offered as an update.
const versions = [
  { key: 'iso-27001', version: '1.0.0' },
  { key: 'iso-27001', version: '1.3.0' },
  { key: 'iso-27001', version: '1.2.0' },
  { key: 'iso-27001', version: '2.0.0' },
  { key: 'framework-nis2', version: '2022.1.0' },
  { key: 'framework-nis2', version: '2022.4.0' },
];

describe('updateTarget', () => {
  it('picks the newest version of the same major', () => {
    expect(updateTarget({ pack_key: 'iso-27001', version: '1.0.0' }, versions)).toBe('1.3.0');
    expect(updateTarget({ pack_key: 'iso-27001', version: '1.3.0' }, versions)).toBeNull();
    expect(updateTarget({ pack_key: 'iso-27001', version: '2.0.0' }, versions)).toBeNull();
    expect(updateTarget({ pack_key: 'framework-nis2', version: '2022.1.0' }, versions)).toBe(
      '2022.4.0',
    );
    expect(updateTarget({ pack_key: 'gdpr', version: '1.0.0' }, versions)).toBeNull();
  });

  it('lists updates for live installs only', () => {
    const installs = [
      { id: 'a', pack_key: 'iso-27001', version: '1.2.0', status: 'installed' },
      { id: 'b', pack_key: 'iso-27001', version: '1.0.0', status: 'archived' },
      { id: 'c', pack_key: 'iso-27001', version: '2.0.0', status: 'installed' },
    ];
    expect([...updatesFor(installs, versions)]).toEqual([['a', '1.3.0']]);
  });
});
