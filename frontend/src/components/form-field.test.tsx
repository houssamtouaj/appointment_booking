import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { FormField } from '@/components/form-field'
import { Input } from '@/components/ui/input'

/**
 * The four wirings `FormField` exists to make non-optional. Each is easy to
 * forget once and impossible to notice afterwards: the field is fine for a
 * sighted mouse user and broken for everybody else.
 */
describe('FormField', () => {
  it('associates the label with the control, so clicking it focuses the input', () => {
    render(
      <FormField label="Booking page address">{(control) => <Input {...control} />}</FormField>,
    )

    // getByLabelText resolves through htmlFor/id, so this passing *is* the
    // association.
    expect(screen.getByLabelText('Booking page address')).toBeInTheDocument()
  })

  it('describes the control by the hint and the error at the same time', () => {
    // Not one or the other. A person needs both "3–40 letters" and "that one is
    // taken" read out, and an `aria-describedby` that names only the newer of
    // the two silently drops the rule.
    render(
      <FormField
        label="Booking page address"
        hint="Letters, digits and hyphens."
        error="That address is taken."
      >
        {(control) => <Input {...control} />}
      </FormField>,
    )

    expect(screen.getByLabelText('Booking page address')).toHaveAccessibleDescription(
      'Letters, digits and hyphens. That address is taken.',
    )
  })

  it('marks an errored control invalid, which is also what draws the red edge', () => {
    render(
      <FormField label="Email" error="Enter a valid email address">
        {(control) => <Input {...control} />}
      </FormField>,
    )

    expect(screen.getByLabelText('Email')).toBeInvalid()
  })

  it('announces the message rather than letting it appear in silence', () => {
    render(
      <FormField label="Email" error="Enter a valid email address">
        {(control) => <Input {...control} />}
      </FormField>,
    )

    expect(screen.getByRole('alert')).toHaveTextContent('Enter a valid email address')
  })

  it('describes nothing when there is nothing to describe', () => {
    render(<FormField label="Email">{(control) => <Input {...control} />}</FormField>)

    const input = screen.getByLabelText('Email')
    expect(input).not.toHaveAttribute('aria-describedby')
    expect(input).toBeValid()
  })
})
