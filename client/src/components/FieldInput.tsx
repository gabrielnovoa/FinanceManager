import { useId, type KeyboardEvent } from 'react'
import { useI18n } from '../i18n'
import type { Field } from '../resources'
import { inputType, isNumeric } from '../fieldValues'
import MonthPicker from './MonthPicker'
import { useSuggestions } from './suggestions'

interface Props {
  field: Field
  value: string
  onChange: (value: string) => void
  className?: string
  autoFocus?: boolean
  disabled?: boolean
  required?: boolean
  invalid?: boolean
  onKeyDown?: (e: KeyboardEvent) => void
}

/** The right input for a field's type — shared by the add forms and inline row editing. */
export default function FieldInput({
  field, value, onChange, className, autoFocus, disabled, required, invalid, onKeyDown,
}: Props) {
  const { t } = useI18n()
  const label = t(field.labelKey)
  const suggestions = useSuggestions(field.suggest)
  const listId = useId()

  if (field.type === 'months') {
    return <MonthPicker value={value} onChange={onChange} disabled={disabled} label={label} />
  }

  if (field.type === 'select') {
    return (
      <select
        className={className}
        value={value}
        autoFocus={autoFocus}
        disabled={disabled}
        required={required}
        aria-label={label}
        aria-invalid={invalid || undefined}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
      >
        {field.options?.map((o) => (
          <option key={o.value} value={o.value}>{t(o.labelKey)}</option>
        ))}
      </select>
    )
  }

  return (
    <>
      <input
        className={className}
        type={inputType(field.type)}
        step={isNumeric(field.type) ? 'any' : undefined}
        value={value}
        autoFocus={autoFocus}
        disabled={disabled}
        required={required}
        aria-label={label}
        aria-invalid={invalid || undefined}
        list={suggestions.length > 0 ? listId : undefined}
        autoComplete={suggestions.length > 0 ? 'off' : undefined}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
      />
      {suggestions.length > 0 && (
        <datalist id={listId}>
          {suggestions.map((s) => <option key={s} value={s} />)}
        </datalist>
      )}
    </>
  )
}
