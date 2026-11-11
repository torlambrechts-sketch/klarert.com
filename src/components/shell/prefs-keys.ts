// Keys of the shell preferences; shared by the client hooks and the inline script.
export const PREFS = {
  railPinned: { key: 'cos.rail.pinned', attr: 'rail', value: 'pinned' },
  panelCollapsed: { key: 'cos.panel.collapsed', attr: 'panel', value: 'collapsed' },
} as const;
/** Applied before first paint by <ShellPrefsScript>, so remembered widths cause no layout shift. */
export const PREFS_SCRIPT = `try{var d=document.documentElement;${Object.values(PREFS)
  .map((p) => `if(localStorage.getItem('${p.key}')==='1')d.dataset.${p.attr}='${p.value}';`)
  .join('')}}catch(e){}`;
