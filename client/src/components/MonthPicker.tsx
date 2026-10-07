import { useI18n } from '../i18n'
import { parseMonths } from '../fieldValues'

interface Props {
  /** Comma-separated month numbers, e.g. "5,8,11". */
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  label?: string
}

/** Twelve toggle buttons for picking the months an annual cost falls due in. */
export default function MonthPicker({ value, onChange, disabled, label }: Props) {
  const { fmt } = useI18n()
  const selected = parseMonths(value)

  function toggle(month: number) {
    const next = selected.includes(month) ? selected.filter((m) => m !== month) : [...selected, month]
    onChange(next.sort((a, b) => a - b).join(','))
  }

  return (
    <div className="month-picker" role="group" aria-label={label}>
      {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => {
        const on = selected.includes(m)
        return (
          <button
            key={m}
            type="button"
            className={`month-opt${on ? ' on' : ''}`}
            aria-pressed={on}
            title={fmt.monthName(m, 'long')}
            disabled={disabled}
            onClick={() => toggle(m)}
          >
            {fmt.monthName(m).replace('.', '')}
          </button>
        )
      })}
    </div>
  )
}
