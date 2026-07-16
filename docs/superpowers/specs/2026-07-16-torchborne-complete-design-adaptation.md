# Torchborne Complete Design Adaptation

## Objective

Rebuild the existing Torchborne static poetry reader around the approved prototype's calmer, text-first experience while preserving the production features already provided by the RSS/Jinja application.

The finished site must support the complete experience: home, search, mood discovery, standard tags, dedicated reader, related and sequential navigation, About, Subscribe, ebook promotion, sharing, theme persistence, loading and failure states, responsive layouts, and accessible keyboard operation.

## Product Direction

Torchborne is a reading product, not a decorative portfolio. The first viewport must identify the publication, establish its emotional territory, and make discovering a poem the obvious next action. Visual atmosphere supports the writing but never competes with it.

The primary taxonomy is:

- Shadow: hidden, difficult, unfinished, grief-oriented, or introspective work.
- Dream: symbolic, imaginative, surreal, spiritual, or liminal work.
- Return: tender, embodied, restorative, hopeful, or homecoming-oriented work.

RSS tags remain available as secondary discovery controls. A post without an explicit Shadow, Dream, or Return tag receives a deterministic inferred mood for presentation; this inference must not overwrite or misrepresent its source tags.

## Chosen Approach

Use a native hybrid rebuild inside the current architecture.

- Keep Python feed retrieval, Jinja rendering, sanitization, static deployment, and existing fallback behavior.
- Rebuild the prototype's visual and interaction direction using semantic HTML, project-owned CSS tokens, and focused vanilla JavaScript.
- Do not ship the prototype's `support.js`, DC runtime, React bridge, Postcode Lottery design-system bundle, logos, tokens, or Myriad Pro font files.
- Do not hardcode prototype poems into production.
- Avoid a framework migration or new runtime dependency.

## Information Architecture

### Header

The sticky header contains:

- Torchborne home control with a flame mark and wordmark.
- About control.
- Theme control with an accessible text alternative and pressed state.
- Primary Subscribe action.

The header remains compact on mobile. Secondary navigation may collapse or use shorter labels, but About, theme, and Subscribe remain reachable.

### Home

The home view contains:

1. A restrained hero with flame mark, `Shadow · Dream · Return` eyebrow, primary editorial statement, short supporting copy, search, and mood filters.
2. Optional ebook spotlight when valid ebook configuration exists.
3. A results header that reports the active query/filter and visible result count.
4. A responsive grid of live RSS posts.
5. Load-more behavior for large feeds.
6. Explicit loading, empty, offline, and error states with recovery actions.

Decorative particles, orbit diagrams, oversized shapes, and ambient blobs are removed. Motion is limited to useful entry, filtering, reader transitions, and reading progress.

### Poem Cards

Each card uses real feed data and provides:

- Mood label plus source tags where available.
- Title.
- Publication date.
- Concise summary or excerpt.
- Optional image only when a usable feed image exists.
- A clear `Read poem` action.
- A secondary share action.

Cards are semantic articles containing links or buttons, not a button wrapped around the entire card. Focus, hover, and touch behavior must communicate the same hierarchy.

### Reader

Opening a post enters a full-page reader state rather than a visually cramped modal. The reader contains:

- Back-to-results control that restores the prior filter and scroll context.
- Mood, source tags, and date.
- Poem title and sanitized article body.
- Font decrease and increase controls with bounded values.
- Reading progress.
- Share and open-on-Substack actions.
- Previous and next navigation based on the current filtered result order.
- Up to three related posts, prioritizing shared mood and then shared source tags.

Reader state is represented in the URL hash so refresh and browser history preserve the selected post without requiring server-side routes. Unknown or unavailable post identifiers recover to the home view with a concise status message.

Keyboard behavior:

- Escape returns to results when the reader is open.
- Left and right arrows navigate previous and next posts only when focus is not inside an editable control.
- All controls have visible focus styles and accessible names.

Reader font scale and theme preference persist in local storage. Storage failures must not break reading.

### About

The About view explains Torchborne's purpose, the meaning of Shadow, Dream, and Return, and the publication's relationship with Substack. It includes a Subscribe action and a clear route back to the poems. About uses URL hash state so browser navigation behaves predictably.

### Subscribe

Subscribe opens an accessible dialog that:

- Explains what readers receive.
- Links to the configured Substack subscription URL.
- Closes via its close control, Escape, or backdrop click.
- Moves focus into the dialog and restores focus to the opening control on close.
- Prevents background interaction while open.

If dialog scripting fails, the primary Subscribe link must still reach Substack.

### Ebook Spotlight

When valid ebook configuration is supplied, retain the ebook spotlight with:

- Cover when available.
- Title, description, metadata, and optional note.
- Kindle CTA.
- Share action.

It uses the same restrained card language and must not dominate the poem-discovery flow.

## Visual System

Create Torchborne-owned design tokens in `public/static/styles.css`:

- Warm paper surface in light mode and warm charcoal surface in dark mode.
- Charcoal primary text and quieter neutral secondary text.
- Ember/gold primary accent for identity and active discovery states.
- Green reserved for Subscribe and external conversion actions.
- Red reserved for errors or destructive messaging.
- Restrained 8–12px radii, thin borders, and shallow shadows.
- System sans-serif for interface text and a licensed/system serif stack for poems and editorial headings.

Typography uses fixed responsive breakpoints rather than continuous viewport-scaled font sizes. Poem text prioritizes comfortable line length, line height, and stanza spacing. Letter spacing is reserved for small uppercase eyebrow labels.

Dark mode must preserve hierarchy and contrast rather than merely invert colors.

## Data and Classification

Existing post fields remain the source of truth. Client normalization produces a stable model containing:

- `title`
- `link`
- stable `slug`
- `description` or summary
- sanitized content
- publication date
- image URL when available
- normalized source tags
- presentation mood

Mood selection follows this order:

1. Exact or case-insensitive source tag match for Shadow, Dream, or Return.
2. Keyword match across normalized source tags.
3. Keyword match across title and summary.
4. Deterministic fallback based on the stable slug so the mood remains consistent between renders.

Search matches title, summary, source tags, and mood label. Mood and tag filters combine with the search query. Load-more operates on the filtered result list.

## State Model

The client maintains a single UI state with:

- current view: home, reader, or about
- selected post slug
- search query
- active mood
- active source tag
- visible result limit
- theme
- reader font scale
- subscribe-dialog open state

State changes render only the affected view and synchronize the URL where required. Theme and font scale persist locally; search and filters remain in memory and are restored when leaving the reader.

## Accessibility

- Preserve the skip link and semantic landmarks.
- Maintain a single logical `h1` for each view.
- Use real buttons for actions and links for navigation destinations.
- Expose active filters using `aria-pressed` or equivalent state.
- Announce result-count and failure changes through a polite live region.
- Give loading states meaningful text and skeletons that are hidden from assistive technology.
- Meet WCAG AA contrast for body text and controls.
- Support keyboard-only use and visible `:focus-visible` styling.
- Respect `prefers-reduced-motion` for every animation and smooth-scroll behavior.
- Preserve useful image alternative text and avoid redundant alt text on decorative imagery.

## Responsive Behavior

- Mobile begins at 320px without horizontal scrolling.
- Header actions remain usable with 44px touch targets.
- Hero, search, and filters stack naturally.
- Cards use one column on narrow screens, two columns when space allows, and no more than three columns at the widest layout.
- Reader stays within a comfortable text measure and navigation cards stack on small screens.
- Dialogs fit within the viewport and allow internal scrolling.
- Long titles, tags, and URLs wrap without clipping.

## Failure and Empty States

- Loading: contextual message and stable skeleton layout.
- No feed results: explain that no poems are available and offer Substack.
- No filtered results: show the active criteria and provide a clear-filter action.
- Feed failure: preserve any server-rendered content; otherwise explain the problem and offer Retry plus Substack.
- Invalid reader hash: return to home and announce that the requested poem is unavailable.
- Missing optional image or ebook data: omit the missing surface without broken placeholders.

## Testing Strategy

Testing follows red-green-refactor.

Python tests verify:

- Build output still copies and renders required assets.
- Generated markup includes the new semantic home, reader, About, Subscribe, and state hooks.
- Optional ebook content remains conditional.
- Existing featured-poem indentation behavior remains intact.

JavaScript behavior tests execute extracted pure helpers with Node and verify:

- Mood classification precedence and deterministic fallback.
- Combined search, mood, and tag filtering.
- Related-post ranking.
- Hash parsing and serialization.
- Reader sequence navigation.

Verification includes:

- Full Python test suite.
- Production build.
- Desktop visual QA.
- Mobile visual QA at 320px and a representative modern-phone width.
- Keyboard navigation and focus restoration.
- Light/dark modes.
- Reduced-motion mode.
- Loading, empty, error, long-title, and missing-image cases.

## Files and Boundaries

- `index.html.j2`: semantic HTML shells, server-rendered data, configuration, and script loading.
- `public/static/styles.css`: Torchborne tokens and all bespoke component/responsive styling.
- `public/static/app.js`: browser UI state, post normalization, filtering, routing, reader behavior, dialogs, and event wiring.
- `public/js/main.js`: existing Cloudflare/RSS worker responsibility remains unchanged unless integration tests expose a compatibility defect.
- `fetch.py`: build configuration and template inputs; change only where the new template requires explicit data.
- `tests/`: markup, classification, filtering, routing, regression, and build tests.

The oversized inline script currently embedded in `index.html.j2` is replaced by `public/static/app.js`. The external file exposes pure helper functions for Node tests while initializing itself only in a browser.

## Acceptance Criteria

The adaptation is complete when:

1. Every approved flow is implemented using live RSS data.
2. Existing search, sharing, ebook, sanitization, build, and fallback behavior remains available.
3. Home, reader, About, and Subscribe match the approved calm prototype direction without importing its runtime or brand assets.
4. Search, mood, and tag filters work together and produce clear result feedback.
5. Reader URL state survives refresh and browser back/forward navigation.
6. Theme and reader scale persist safely.
7. Keyboard, focus, reduced-motion, loading, empty, and error behavior pass QA.
8. The site builds successfully and all automated tests pass.
9. Desktop and mobile visual QA show no clipping, overlap, or horizontal scrolling.

## Out of Scope

- Migrating to React, Next.js, or another application framework.
- Adding a database, CMS, accounts, comments, payments, or analytics.
- Editing source poems or publishing new Substack posts.
- Importing the prototype's hardcoded sample poems.
- Reusing Postcode Lottery brand assets, fonts, or runtime code.
