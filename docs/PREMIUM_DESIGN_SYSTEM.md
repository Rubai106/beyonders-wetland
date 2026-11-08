# Beyonders — Premium Design System (Phase 2)

The design system is two visual languages with one job: make the science
legible. It is documented here so a future change can be checked against it
instead of drifting into generic dashboard styling.

## 1. The two surfaces

| Surface | Where | Tokens |
|---|---|---|
| **Paper shell** | `/observability`, `/lineage`, study pages' prose | Background `#f4f2ec`; ink `#1d2733`; secondary `#3c4754`; muted `#6b7684`; accent ochre `#8a6d2b`; hairline `#d8d3c4`; card `#ffffff` |
| **Dark instrument** | Evidence chain panel, lineage graph canvas, globe hero | Background `#0a131e`; panel `#16222f`; text `#e9eef4` / `#f4f7fa`; secondary `#aebdca`; accent teal `#83c9c1`; amber `#e9c88e`; hairline `rgba(155,177,198,.19)` |

Rule: prose and judgment live on paper; instruments and graphs live dark.
Never put a dashboard card grid on paper, and never put long explanatory
paragraphs inside a dark instrument panel.

## 2. Typography

- Display/headlines: serif for the landing hero (`var(--serif)`); the
  paper pages use a tight grotesque (`system-ui`, `-0.02em` tracking on
  `h1`, 40px desktop / 30px mobile).
- Eyebrows: 11–12px, 700, `0.12–0.14em` letter-spacing, uppercase,
  ochre on paper / teal on dark.
- Body: 15–17px, line-height 1.55–1.6, max `72ch`.
- Data/mono: `ui-monospace, SFMono-Regular, Menlo, monospace` for run IDs,
  granule IDs, status chips, and numbers that must be copied exactly.
- Numbers that matter are shown with units and never rounded away from
  their meaning (F1 7.4%, not "≈7%"; 24.48 km², not "≈24").

## 3. Status is never colour alone

Every evidence state is a glyph **and** a word:

- ● Recorded (`#7fd1a8` on dark / `#2e7d32` on paper)
- ◐ Inconclusive (`#e9c88e` / ochre)
- ○ Not recorded (`#d08a8a` / muted)
- ◆ Partial record (`#9db8d2`)

The maturity ladder uses ●/○ with the same rule. Charts that encode
state must also label it in text (the matrix has screen-reader text per
cell; the lineage inspector spells the status out).

## 4. Visual-first hierarchy

1. Interactive maps and spatial visualizations.
2. Temporal animations and comparisons.
3. Charts and scientific plots.
4. Interactive evidence exploration (lineage graph, hypothesis panel).
5. Concise labels, annotations, contextual explanation.

Text supports; it never dominates. Advanced technical detail lives behind
progressive disclosure: expandable evidence panels, tooltips, detail
drawers, and the lineage node inspector. A page that reads like
documentation has failed this hierarchy.

## 5. Motion

- Motion communicates a change in data or investigation state (pulse
  playback, node selection highlight, scroll reveal). It never decorates.
- No animation runs on the lineage graph's layout; selection is instant.
- `prefers-reduced-motion: reduce` disables transitions in the lineage
  and landing styles. The globe hero and hydrograph playback are
  user-initiated (play/pause, drag), never autoplayed.

## 6. Accessibility

- Interactive graph nodes are real buttons (`role="button"`, `tabIndex`,
  Enter/Space activation, `aria-pressed`, `aria-label` with title +
  status; `:focus-visible` stroke).
- The maturity matrix is a real `<table>` with `scope` headers and
  screen-reader text per cell; it scrolls horizontally on small screens
  instead of collapsing into unreadability.
- Contrast: ink on paper and `#f4f7fa` on `#16222f` both exceed AA for
  body text; status colours are always paired with glyphs/words.
- No information is conveyed by colour alone anywhere in the product.

## 7. What this system forbids

- Generic AI-dashboard styling: gradient hero cards, glassmorphism,
  floating stat cards, decorative charts with arbitrary numbers.
- Confidence scores invented to make a chart look scientific.
- Fresh-data indicators that merely mean "the page loaded".
- The same template forced onto every domain: wetlands, forests,
  volcanoes, and agriculture share the shell and the status language,
  but keep their own workspaces, methods, and visual character.
