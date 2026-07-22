# Kanit Global Font Design

## Goal

Use Kanit as the primary typeface throughout SOLE STOCK, including navigation, headings, tables, forms, buttons, badges, and responsive mobile controls. The change must not alter page structure or application behavior.

## Decision

Load Kanit with `next/font/google`. This lets Next.js optimize and self-host the generated font assets instead of making the browser request Google Fonts at runtime.

Configure the font once in the root layout with:

- Thai and Latin subsets.
- Weights 400, 500, 600, 700, 800, and 900, matching the weights already used by the interface.
- `display: "swap"` so text remains visible while the font loads.
- A CSS variable named `--font-kanit` applied to the root body.

## Styling

Update the global body font stack to use `var(--font-kanit)` first, followed by the existing Thai-capable system fallbacks. Existing inputs, selects, buttons, and textareas already inherit their font, so component-specific overrides are unnecessary.

No font sizes, spacing, colors, component dimensions, or breakpoints will change as part of this work.

## Failure Handling

The production build must fail visibly if Next.js cannot prepare the selected font assets. At runtime, the system font stack remains available as a fallback if the generated web font cannot be displayed.

## Verification

- Add a focused layout test that mocks `next/font/google` and verifies the Kanit CSS variable class is attached to the body.
- Run the complete unit test suite, TypeScript check, lint, and production build.
- Check the dashboard at desktop and mobile widths to confirm Kanit is applied and Thai labels do not overflow their containers.

## Non-goals

- No separate heading or brand font.
- No typography scale redesign.
- No component layout or content changes.
- No manually downloaded font files.
