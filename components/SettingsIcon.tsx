export default function SettingsIcon({size=32}:{size?:number}) {
 return <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true" focusable="false" style={{flexShrink:0,display:"block"}}>
  <rect x="1" y="1" width="46" height="46" rx="11" fill="#111e26" stroke="#40535e"/>
  <g transform="translate(8 8) scale(1.333)" stroke="#fd9800" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="m9 3 1-1h4l1 1 .5 2 2 1 2-.5 1.5 1.5.5 2-1.5 1.5v3L21 15l-.5 2L19 18.5l-2-.5-2 1-.5 2-1 1h-4l-1-1-.5-2-2-1-2 .5L2 17l-.5-2L3 13.5v-3L1.5 9 2 7l1.5-1.5 2 .5 2-1L8 3Z"/><circle cx="11.25" cy="12" r="3.5" stroke="white"/></g>
 </svg>;
}
