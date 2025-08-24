# Internal Style Guide

## Accent Color Tokens

Each accent token comes in a gradient form and a solid counterpart:

- `--accent` / `--accent-solid`: primary gold/orange. Use for main actions, default highlights and brand elements.
- `--accent-2` / `--accent-2-solid`: secondary red. Reserve for destructive actions, errors or urgent notices.
- `--accent-3` / `--accent-3-solid`: tertiary blue. Use for informational elements and decorative highlights.

## Component Usage

- **Cards** expose `--card-accent` and `--card-accent-solid` variables and cycle through accent palettes by default. Apply the `accent-2` or `accent-3` class to override.
- **Shapes** use `shape accent`, `shape accent-2` and `shape accent-3` classes to color floating decorations.
- **Chips** support `accent`, `accent-2` and `accent-3` classes which set border and text colors.

Following these conventions keeps color usage consistent throughout the project.

