// Inline SVG icons for the row actions. Kept local rather than pulling in an
// icon package: four small shapes aren't worth a dependency, and drawing them
// with `currentColor` means each button themes itself from its own CSS.

export type IconName = 'edit' | 'delete' | 'save' | 'cancel'

const PATHS: Record<IconName, string[]> = {
  edit: ['M4 20h4L18.5 9.5a2.83 2.83 0 0 0-4-4L4 16v4Z', 'M13.5 6.5l4 4'],
  delete: [
    'M4 7h16',
    'M9 7V4h6v3',
    'M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13',
    'M10 11v6',
    'M14 11v6',
  ],
  save: ['M20 6 9 17l-5-5'],
  cancel: ['M18 6 6 18', 'M6 6l12 12'],
}

export default function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name].map((d) => <path key={d} d={d} />)}
    </svg>
  )
}
