# Inventory Filtered Pair Summary Design

## Goal

Add a total-pairs summary to the inventory page header so users can see both the number of matching variants and the combined on-hand quantity at a glance.

## Behavior

- Keep the existing item-count summary based on the filtered inventory rows.
- Add a second summary showing the sum of `quantity` across those same filtered rows.
- Recalculate both values immediately whenever the search query, model, color, or stock-status filter changes.
- Show `0 รายการ` and `0 คู่` when no rows match.
- Do not change inventory data, persistence, filtering rules, or table/card contents.

## Interface

The inventory header will contain a right-aligned summary group with two visually matching cards:

1. The current filtered row count, labeled `รายการ`.
2. The current filtered quantity total, labeled `คู่`.

On desktop the cards remain side by side at the right edge of the header. On narrow screens the header may wrap, with the summary group kept together and aligned to the right so the title and summary do not overflow.

## Data Flow

`filterInventory(snapshot, filters)` remains the single source for the visible rows. The page derives the total pairs from those rows with a sum of `row.quantity`, ensuring the summary and rendered results cannot use different filter criteria.

## Testing

- Add a component assertion for the initial item count and pair total.
- Change a filter and assert that both summaries update to match the remaining rows.
- Keep existing desktop and mobile browser coverage to guard against horizontal overflow.
