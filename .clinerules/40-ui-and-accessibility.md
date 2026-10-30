# UI and Accessibility

Apply these instructions when implementing frontend UI.

## Design direction
- Maintain Launchboard's warm, near-white background (`--color-bg`), dark navy/charcoal navigation (`--color-sidebar`), muted teal/green accents (`--color-accent`), restrained shadows (`--shadow-card`), and consistent visual hierarchy. These are defined in the `@theme` block in `src/styles.css`.
- Prefer a professional, calm SaaS interface over flashy or overly decorative styling.
- Keep spacing, typography, buttons, badges, forms, and dialogs visually consistent — reuse the existing spacing (`s1`…`s6`), radius, shadow, and color tokens rather than inventing new values.
- Avoid excessive nested cards, gradients, animations, and unnecessary decoration.
- Preserve readable content density and useful whitespace.

## Accessibility
- Use semantic HTML and correctly labelled form fields.
- Use real buttons for actions.
- Provide accessible names for icon-only controls (for example an `aria-label` of "Edit" plus the record title).
- Preserve visible keyboard focus (the global `:focus-visible` outline is part of the design).
- Maintain appropriate contrast.
- Preserve keyboard operation and focus restoration for dialogs: dialogs are native `<dialog>` elements and must keep trapping focus, closing on Escape, and returning focus to the control that opened them (with `#main-content` as the fallback when the trigger no longer exists).
- Ensure changes remain usable with keyboard navigation.
- Provide accessible alternatives for interactions that otherwise depend on dragging.
- Respect reduced-motion preferences when adding animations.

## Responsive behavior
- Preserve usability at mobile, tablet, and desktop sizes. Existing breakpoints are 860px and 640px.
- Check for horizontal overflow.
- Ensure dialogs remain usable on small screens.
- Do not fix mobile issues by merely shrinking everything.
- Reuse established responsive patterns (e.g. the table-to-cards transformation).

## Styling
- Tailwind CSS v4 is the styling system. Use utilities for ordinary component, page, form, dialog, and badge presentation.
- `src/styles.css` contains the `@theme` tokens and necessary global/base/accessibility rules, not a semantic component stylesheet.
- Retain custom CSS only for global element defaults, accessibility, or specialized behavior that utilities cannot express clearly.
- Use the existing theme values instead of inventing unrelated colors, spacing, radii, or shadows.
- Avoid duplicate or conflicting styling for the same component.
- Stable selectors used by tests, such as `list-btn`, may remain in markup without a legacy CSS rule.
