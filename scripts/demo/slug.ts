// The demo workspace's address and the prefix of its retired copies (docs/17), shared by the build and the purge.
export const DEMO_SLUG = 'meridian-demo';
/** `pnpm seed:demo` with DEMO_RESET=1 renames the live copy to this plus a time stamp; the purge removes those. */
export const RETIRED_PREFIX = `${DEMO_SLUG}-retired-`;
