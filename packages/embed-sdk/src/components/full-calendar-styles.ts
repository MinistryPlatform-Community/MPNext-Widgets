import { HEADING_RESET_STYLES } from "../shared/heading-level";

// ────────────────────────────────────────────────────────────────────────────
// full-calendar-styles.ts
// All CSS style constants for the <next-full-calendar> widget.
// ────────────────────────────────────────────────────────────────────────────

// ── 1. Base Styles ──────────────────────────────────────────────────────────
// Host, container, loading/error states, spinner, and the FullCalendar 7 theme
// custom-property contract (the brand palette that themes/classic/theme.css
// reads — see the note above the :host block) plus the event-chip rule that
// replaces the old `.fc-event` selectors.

export const BASE_STYLES = `
  :host {
    display: block;
    font-family: var(--_nw-font-family);
  }

  /* ── Layout ── */

  .nw-fc-container {
    width: 100%;
    box-sizing: border-box;
  }

  .nw-fc-mount {
    width: 100%;
  }

  /* ── States ── */

  .nw-fc-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--_nw-space-3);
    padding: 60px var(--_nw-space-6);
    color: #9E9E9E;
    text-align: center;
  }

  .nw-fc-error {
    color: #991b1b;
  }

  .nw-fc-error svg {
    color: var(--_nw-color-error);
  }

  .nw-fc-loading p {
    font-size: 15px;
    margin: 0;
  }

  .nw-fc-spinner {
    width: 32px;
    height: 32px;
    border: 3px solid #E0E0E0;
    border-top-color: var(--_nw-color-primary);
    border-radius: 50%;
    animation: nw-fc-spin 0.75s linear infinite;
  }

  @keyframes nw-fc-spin {
    to { transform: rotate(360deg); }
  }

  /* ── FullCalendar 7 theme contract ── */
  /*
   * FullCalendar 7 ships no CSS inside its JS bundle. 'skeleton.css' and
   * 'themes/classic/theme.css' are <link>ed into this shadow root by
   * loadFullCalendar(), and they only *consume* these custom properties —
   * theme.css has no :root rule of its own and 67 of its 68 var() uses carry
   * no fallback.
   *
   * The upstream values live in 'themes/classic/palette.css', which is
   * deliberately NOT loaded: it declares them on ':root', a selector that
   * never matches inside a shadow tree, so the whole calendar would render
   * with no borders, no today highlight, no event chips and no now-indicator.
   * Declaring them on :host both fixes that and puts the brand palette in —
   * which is why there are no '.fc-*' rules below any more. v7's own class
   * names are build-generated hashes ('fc-1q', 'fc-DP', …), not a public API.
   *
   * KEEP THIS COMPLETE. Every property below is read by theme.css or by
   * themes/classic/global.js with no fallback; dropping one silently removes
   * whatever it paints. Re-derive the list after a version or theme bump:
   *   curl -sL ".../fullcalendar@<ver>/themes/<theme>/theme.css"
   *     | grep -oE -- "--fc-[a-z0-9-]+" | sort -u
   */

  /*
   * Brand-coloured entries read the resolved '--_nw-*' theme tokens (W7a,
   * shared/theme-tokens.ts) so a church's '--nw-color-primary' etc. reaches
   * the calendar too; so do the neutrals whose value is exactly a token's
   * default (on-primary #fff, surface #ffffff, text-subtle #474747 — W7b).
   * Each keeps its old literal as the var() fallback, so the
   * contract stays complete even without the token block. Tints derived from
   * the brand (the rgba(0, 76, 151, …) values, #D6F0FC) stay literal: CSS
   * cannot derive them from a token without color-mix(), which is a visual
   * change on browsers that lack it.
   */
  :host {
    /* Skeleton stacking order (skeleton.css declares these on :root too). */
    --fc-sticky-header-footer-z: 3;
    --fc-popover-z: 4;

    /* Buttons. FullCalendar's own toolbar is off ('headerToolbar: false') so
       nothing reads these today; kept in brand so enabling it stays correct. */
    --fc-classic-button: var(--_nw-color-primary, #004C97);
    --fc-classic-button-border: var(--_nw-color-primary, #004C97);
    --fc-classic-button-strong: var(--_nw-color-secondary, #002855);
    --fc-classic-button-strong-border: var(--_nw-color-secondary, #002855);
    --fc-classic-button-outline: rgba(0, 76, 151, 0.5);
    --fc-classic-button-foreground: var(--_nw-color-on-primary, #fff);

    /* Primary / events */
    --fc-classic-primary: var(--_nw-color-primary, #004C97);
    --fc-classic-event: var(--_nw-color-primary, #004C97);
    --fc-classic-event-contrast: var(--_nw-color-on-primary, #fff);
    --fc-classic-background-event: #D6F0FC;
    --fc-classic-background-event-opacity: 50%;
    --fc-classic-background-event-foreground-opacity: 50%;
    --fc-classic-highlight: rgba(0, 76, 151, 0.1);
    --fc-classic-today: #D6F0FC;
    --fc-classic-now: var(--_nw-color-error, #FF6D6A);
    --fc-classic-small-dot-width: 8px;
    --fc-classic-large-dot-width: 10px;

    /* Neutral backgrounds */
    --fc-classic-background: var(--_nw-color-surface, #ffffff);
    --fc-classic-faint: #f9fafb;
    --fc-classic-muted: rgba(0, 0, 0, 0.08);
    --fc-classic-strong: rgba(0, 0, 0, 0.14);

    /* Neutral foregrounds */
    --fc-classic-foreground: var(--_nw-color-text, #2D2926);
    --fc-classic-faint-foreground: #9E9E9E;
    --fc-classic-muted-foreground: var(--_nw-color-text-subtle, #474747);

    /* Neutral borders */
    --fc-classic-border: #E0E0E0;
    --fc-classic-strong-border: #9E9E9E;
  }

  /* ── Event chips ── */
  /*
   * Applied via the 'eventClass' option in initCalendar() (v7's rename of
   * 'eventClassNames'), because the '.fc-event' selector this replaces no
   * longer exists. Colour comes from the vars above; only the geometry and
   * the hover affordance need a rule.
   */

  .nw-fc-event {
    border-radius: 4px;
    cursor: pointer;
    transition: opacity 0.15s ease, transform 0.1s ease;
  }

  .nw-fc-event:hover {
    opacity: 0.85;
    transform: translateY(-1px);
  }
`;

// ── 2. Toolbar Styles ───────────────────────────────────────────────────────
// Custom toolbar that replaces FullCalendar's built-in toolbar with branded
// prev/next/today buttons, a centered title, and view-switching buttons.

export const TOOLBAR_STYLES = `
  /* ── Custom Toolbar ── */

  /*
   * The title is a heading (CROSS-3). With show-toolbar="false" it is still
   * rendered, visually hidden, so the widget keeps a heading in every view.
   */
  .nw-fc-sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  .nw-fc-toolbar {
    display: flex;
    flex-direction: row;
    justify-content: space-between;
    align-items: center;
    padding: var(--_nw-space-2) 0;
    margin-bottom: var(--_nw-space-4);
    flex-wrap: wrap;
  }

  .nw-fc-toolbar-left {
    display: flex;
    flex-direction: row;
    gap: var(--_nw-space-1);
  }

  .nw-fc-toolbar-center {
    font-size: 1.2em;
    font-weight: var(--_nw-font-weight-heading);
    color: var(--_nw-color-secondary);
  }

  .nw-fc-toolbar-right {
    display: flex;
    flex-direction: row;
    gap: var(--_nw-space-1);
  }

  .nw-fc-toolbar-btn {
    background: var(--_nw-color-surface);
    border: 1px solid #E0E0E0;
    border-radius: 6px;
    padding: 6px 14px;
    font-size: 0.82em;
    font-weight: 600;
    color: var(--_nw-color-text-subtle);
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s, color 0.15s;
  }

  .nw-fc-toolbar-btn:hover {
    background: var(--_nw-color-surface-muted);
    border-color: #9E9E9E;
  }

  .nw-fc-toolbar-btn.active {
    background: var(--_nw-color-primary);
    color: var(--_nw-color-on-primary);
    border-color: var(--_nw-color-primary);
  }

  .nw-fc-toolbar-btn.active:hover {
    background: var(--_nw-color-secondary);
  }

  .nw-fc-toolbar-nav {
    background: var(--_nw-color-surface);
    border: 1px solid #E0E0E0;
    border-radius: 6px;
    padding: 6px 14px;
    font-size: 0.82em;
    font-weight: 600;
    color: var(--_nw-color-text-subtle);
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s, color 0.15s;
    width: 36px;
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .nw-fc-toolbar-nav:hover {
    background: var(--_nw-color-surface-muted);
    border-color: #9E9E9E;
  }

  /* ── Toolbar Responsive ── */

  @media (max-width: 600px) {
    .nw-fc-toolbar {
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: var(--_nw-space-3);
    }
  }
`;

// ── 3. Card Grid Styles ─────────────────────────────────────────────────────
// Card-based event grid with image, date block overlay, body content,
// "Learn More" CTA, show-more button, and empty state.

export const CARDS_STYLES = `
  /* ── Card Grid ── */

  .nw-fc-cards-grid {
    display: grid;
    gap: var(--_nw-space-6);
    grid-template-columns: repeat(3, 1fr);
  }

  @media (max-width: 768px) {
    .nw-fc-cards-grid {
      grid-template-columns: repeat(2, 1fr);
    }
  }

  @media (max-width: 480px) {
    .nw-fc-cards-grid {
      grid-template-columns: 1fr;
    }
  }

  /* ── Card ── */

  .nw-fc-card {
    background: var(--_nw-color-surface);
    border-radius: var(--_nw-radius);
    box-shadow: 0 1px 4px rgba(0,0,0,0.08), 0 2px 12px rgba(0,0,0,0.04);
    overflow: hidden;
    display: flex;
    flex-direction: column;
    transition: box-shadow 0.2s, transform 0.2s;
  }

  .nw-fc-card:hover {
    box-shadow: 0 4px 16px rgba(0,0,0,0.12);
    transform: translateY(-2px);
  }

  /* ── Card Image ── */

  .nw-fc-card-image {
    position: relative;
    aspect-ratio: 16 / 9;
    overflow: hidden;
    background: var(--_nw-color-surface-muted);
  }

  .nw-fc-card-image img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .nw-fc-card-placeholder {
    width: 100%;
    height: 100%;
    background: var(--_nw-color-primary);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  /* ── Card Date Block (dark navy overlay) ── */

  .nw-fc-card-date-block {
    position: absolute;
    bottom: 0;
    left: 0;
    background: var(--_nw-color-secondary);
    padding: var(--_nw-space-2) 14px;
    text-align: center;
    min-width: 64px;
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  .nw-fc-card-date-block .nw-fc-date-dow {
    font-size: 0.55em;
    text-transform: uppercase;
    color: rgba(255,255,255,0.8);
    font-weight: 600;
    letter-spacing: 0.08em;
  }

  .nw-fc-card-date-block .nw-fc-date-day {
    font-size: 1.6em;
    font-weight: 700;
    color: var(--_nw-color-on-primary);
    line-height: 1.15;
  }

  .nw-fc-card-date-block .nw-fc-date-month {
    font-size: 0.6em;
    text-transform: uppercase;
    color: rgba(255,255,255,0.8);
    font-weight: 700;
    letter-spacing: 0.06em;
  }

  /* ── Card Body ── */

  .nw-fc-card-body {
    padding: 14px var(--_nw-space-4);
    display: flex;
    flex-direction: column;
    gap: 6px;
    flex: 1;
  }

  .nw-fc-card-info {
    display: flex;
    align-items: center;
    gap: var(--_nw-space-2);
    flex-wrap: wrap;
  }

  .nw-fc-card-time {
    font-size: 0.82em;
    color: var(--_nw-color-text-subtle);
    font-weight: 500;
  }

  .nw-fc-card-campus {
    font-size: 0.82em;
    color: var(--_nw-color-text-subtle);
    font-weight: 500;
  }

  .nw-fc-card-campus::before {
    content: '|';
    margin-right: var(--_nw-space-2);
    color: #E0E0E0;
  }

  .nw-fc-card-title {
    font-size: 1.05em;
    font-weight: 600;
    color: var(--_nw-color-primary);
    margin: var(--_nw-space-1) 0 2px;
    line-height: 1.3;
  }

  /* ── Card CTA (full-width dark bar) ── */

  .nw-fc-card-learn-more {
    display: block;
    width: 100%;
    padding: var(--_nw-space-3);
    background: var(--_nw-color-secondary);
    color: var(--_nw-color-on-primary);
    border: none;
    border-radius: 0;
    font-size: 0.8em;
    font-weight: 700;
    cursor: pointer;
    text-align: center;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    transition: background 0.15s;
    margin-top: auto;
  }

  .nw-fc-card-learn-more:hover {
    background: var(--_nw-color-primary);
  }

  /* ── Show More ── */

  .nw-fc-show-more {
    display: block;
    margin: var(--_nw-space-6) auto 0;
    padding: 10px 32px;
    background: var(--_nw-color-surface);
    border: 2px solid var(--_nw-color-primary);
    color: var(--_nw-color-primary);
    border-radius: var(--_nw-radius);
    font-size: 0.9em;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s;
  }

  .nw-fc-show-more:hover {
    background: var(--_nw-color-primary);
    color: var(--_nw-color-on-primary);
  }

  /* ── Cards Empty ── */

  .nw-fc-cards-empty {
    text-align: center;
    padding: 60px var(--_nw-space-6);
    color: #9E9E9E;
    font-size: 0.95em;
  }
`;

// ── 4. Filter Styles ────────────────────────────────────────────────────────
// Campus and Ministry filter chip rows used above the card grid or calendar.

export const FILTER_STYLES = `
  /* ── Filters ── */

  .nw-fc-filters {
    display: flex;
    flex-direction: column;
    gap: var(--_nw-space-3);
    margin-bottom: var(--_nw-space-6);
  }

  .nw-fc-filter-section {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--_nw-space-2);
  }

  .nw-fc-filter-label {
    font-size: 0.8em;
    font-weight: 700;
    color: var(--_nw-color-text-subtle);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    min-width: 70px;
  }

  .nw-fc-filter-chip {
    display: inline-flex;
    align-items: center;
    gap: var(--_nw-space-1);
    padding: 5px 14px;
    border-radius: 999px;
    font-size: 0.8em;
    font-weight: 600;
    cursor: pointer;
    border: 1.5px solid var(--_nw-color-primary);
    color: var(--_nw-color-primary);
    background: var(--_nw-color-surface);
    transition: all 0.15s;
    user-select: none;
  }

  .nw-fc-filter-chip:hover {
    background: #D6F0FC;
  }

  .nw-fc-filter-chip.active {
    background: var(--_nw-color-primary);
    color: var(--_nw-color-on-primary);
    border-color: var(--_nw-color-primary);
  }

  .nw-fc-filter-chip.active:hover {
    background: var(--_nw-color-secondary);
    border-color: var(--_nw-color-secondary);
  }

  .nw-fc-filter-chip .nw-fc-chip-check {
    width: 14px;
    height: 14px;
    display: none;
  }

  .nw-fc-filter-chip.active .nw-fc-chip-check {
    display: inline;
  }
`;

// ── 5. Mini Calendar Styles ─────────────────────────────────────────────────
// Split layout with a sticky mini-calendar sidebar and a cards panel.
// Includes the month grid, density dots, today link, and density legend.

export const MINI_CAL_STYLES = `
  /* ── Split Layout ── */

  .nw-fc-split-layout {
    display: flex;
    gap: var(--_nw-space-6);
  }

  .nw-fc-mini-cal-panel {
    width: 280px;
    flex-shrink: 0;
    position: sticky;
    top: 0;
    align-self: flex-start;
  }

  .nw-fc-cards-panel {
    flex: 1;
    min-width: 0;
  }

  @media (max-width: 768px) {
    .nw-fc-split-layout {
      flex-direction: column;
    }

    .nw-fc-mini-cal-panel {
      width: 100%;
      position: static;
    }
  }

  /* ── Mini Calendar ── */

  .nw-fc-mini-cal {
    background: var(--_nw-color-surface);
    border-radius: var(--_nw-radius-lg);
    border: 1px solid #E0E0E0;
    padding: var(--_nw-space-4);
  }

  .nw-fc-mini-cal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: var(--_nw-space-3);
  }

  .nw-fc-mini-cal-title {
    font-size: 0.95em;
    font-weight: var(--_nw-font-weight-heading);
    color: var(--_nw-color-secondary);
  }

  .nw-fc-mini-cal-nav {
    background: none;
    border: none;
    cursor: pointer;
    padding: var(--_nw-space-1);
    color: var(--_nw-color-text-subtle);
    font-size: 16px;
    border-radius: 4px;
  }

  .nw-fc-mini-cal-nav:hover {
    background: var(--_nw-color-surface-muted);
  }

  /* ── Mini Calendar Grid ── */

  .nw-fc-mini-cal-grid {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 2px;
    text-align: center;
  }

  .nw-fc-mini-cal-dow {
    font-size: 0.7em;
    font-weight: 600;
    color: #9E9E9E;
    padding: var(--_nw-space-1);
    text-transform: uppercase;
  }

  .nw-fc-mini-cal-day {
    font-size: 0.82em;
    padding: var(--_nw-space-1) 0;
    cursor: pointer;
    border-radius: 6px;
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    min-height: 36px;
    justify-content: flex-start;
  }

  .nw-fc-mini-cal-day:hover {
    background: var(--_nw-color-surface-muted);
  }

  .nw-fc-mini-cal-day.today .nw-fc-mini-day-num {
    background: var(--_nw-color-primary);
    color: var(--_nw-color-on-primary);
    border-radius: 50%;
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .nw-fc-mini-cal-day.selected {
    background: #D6F0FC;
  }

  .nw-fc-mini-cal-day.other-month {
    opacity: 0.3;
  }

  .nw-fc-mini-day-num {
    line-height: 1;
  }

  /* ── Density Dots ── */

  .nw-fc-density-dots {
    display: flex;
    gap: 2px;
    justify-content: center;
  }

  .nw-fc-density-dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--_nw-color-secondary);
  }

  /* ── Today Link ── */

  .nw-fc-mini-cal-today-link {
    display: block;
    text-align: center;
    margin-top: var(--_nw-space-2);
    font-size: 0.8em;
    color: var(--_nw-color-primary);
    cursor: pointer;
    font-weight: 600;
  }

  .nw-fc-mini-cal-today-link:hover {
    text-decoration: underline;
  }

  /* ── Density Legend ── */

  .nw-fc-density-legend {
    display: flex;
    gap: var(--_nw-space-3);
    justify-content: center;
    margin-top: var(--_nw-space-3);
    font-size: 0.7em;
    color: #9E9E9E;
  }

  .nw-fc-legend-item {
    display: flex;
    align-items: center;
    gap: var(--_nw-space-1);
  }
`;

// ── 6. Modal Styles ─────────────────────────────────────────────────────────
// Enhanced event detail modal with image header, badges, meta rows,
// description, registration CTA, admin section, and MP link.

export const MODAL_STYLES = `
  /* ── Event Modal ── */

  .nw-fc-modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    z-index: 9999;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--_nw-space-4);
    opacity: 0;
    transition: opacity 0.2s ease;
    box-sizing: border-box;
  }

  .nw-fc-modal-overlay.nw-fc-modal-visible {
    opacity: 1;
  }

  .nw-fc-modal {
    background: var(--_nw-color-surface);
    border-radius: var(--_nw-radius-lg);
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.25);
    width: 100%;
    max-width: 520px;
    max-height: 90vh;
    overflow-y: auto;
    transform: translateY(8px) scale(0.98);
    transition: transform 0.2s ease;
  }

  .nw-fc-modal-overlay.nw-fc-modal-visible .nw-fc-modal {
    transform: translateY(0) scale(1);
  }

  .nw-fc-modal-header {
    padding: var(--_nw-space-5) var(--_nw-space-5) var(--_nw-space-4) var(--_nw-space-5);
    border-bottom: 1px solid #E0E0E0;
    padding-left: var(--_nw-space-6);
  }

  .nw-fc-modal-title-row {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--_nw-space-3);
    margin-bottom: 10px;
  }

  .nw-fc-modal-title {
    font-size: 1.15em;
    font-weight: var(--_nw-font-weight-heading);
    color: var(--_nw-color-text);
    margin: 0;
    line-height: 1.3;
  }

  .nw-fc-modal-close {
    flex-shrink: 0;
    width: 32px;
    height: 32px;
    background-color: #F0F0F0;
    border: 1px solid #D0D0D0;
    border-radius: 50%;
    cursor: pointer;
    font-size: 20px;
    line-height: 1;
    color: #555;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease;
    padding: 0;
  }

  .nw-fc-modal-close:hover {
    background-color: #E0E0E0;
    border-color: #BBB;
    color: var(--_nw-color-text);
  }

  .nw-fc-modal-badges {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: var(--_nw-space-1);
  }

  .nw-fc-badge {
    display: inline-flex;
    align-items: center;
    padding: 3px 10px;
    border-radius: 999px;
    font-size: 0.72em;
    font-weight: 600;
    letter-spacing: 0.02em;
    text-transform: uppercase;
    color: var(--_nw-color-on-primary);
  }

  .nw-fc-badge-type {
    /* background set inline via event color */
  }

  .nw-fc-badge-campus {
    background-color: var(--_nw-color-secondary);
  }

  .nw-fc-badge-featured {
    background-color: var(--_nw-color-accent);
    color: var(--_nw-color-text);
  }

  .nw-fc-modal-body {
    padding: var(--_nw-space-4) var(--_nw-space-5) var(--_nw-space-5) var(--_nw-space-5);
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .nw-fc-modal-meta-row {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    color: var(--_nw-color-text-subtle);
    font-size: 0.9em;
    line-height: 1.4;
  }

  .nw-fc-modal-meta-icon {
    flex-shrink: 0;
    color: #9E9E9E;
    margin-top: 1px;
  }

  .nw-fc-modal-meta-text {
    flex: 1;
  }

  .nw-fc-modal-description {
    margin-top: 6px;
    padding-top: var(--_nw-space-3);
    border-top: 1px solid #E0E0E0;
    color: var(--_nw-color-text-subtle);
    font-size: 0.9em;
    line-height: 1.6;
  }

  .nw-fc-modal-description p {
    margin: 0;
  }

  .nw-fc-modal-empty {
    color: #9E9E9E;
    font-size: 0.9em;
    font-style: italic;
    margin: 0;
  }

  .nw-fc-modal-actions {
    margin-top: var(--_nw-space-3);
    padding-top: var(--_nw-space-4);
    border-top: 1px solid #E0E0E0;
  }

  .nw-fc-register-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 10px var(--_nw-space-6);
    background-color: var(--_nw-button-bg);
    color: var(--_nw-button-fg);
    font-size: 0.9em;
    font-weight: 600;
    border-radius: var(--_nw-button-radius);
    text-decoration: none;
    transition: background-color 0.15s ease;
    cursor: pointer;
  }

  .nw-fc-register-btn:hover {
    background-color: var(--_nw-button-bg-hover);
  }

  /* ── Modal Image ── */

  .nw-fc-modal-image {
    width: 100%;
    aspect-ratio: 16 / 9;
    object-fit: cover;
    display: block;
    border-radius: var(--_nw-radius-lg) var(--_nw-radius-lg) 0 0;
  }

  .nw-fc-modal-image-placeholder {
    width: 100%;
    aspect-ratio: 16 / 9;
    background: var(--_nw-color-primary);
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--_nw-radius-lg) var(--_nw-radius-lg) 0 0;
  }

  /* ── Admin Section ── */

  .nw-fc-admin-section {
    margin-top: var(--_nw-space-3);
    padding: var(--_nw-space-4);
    background: #f9fafb;
    border-radius: var(--_nw-radius);
    border: 1px solid #E0E0E0;
  }

  .nw-fc-admin-divider {
    display: flex;
    align-items: center;
    gap: var(--_nw-space-2);
    margin-bottom: var(--_nw-space-3);
    font-size: 0.75em;
    font-weight: 700;
    color: #9E9E9E;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .nw-fc-admin-divider::after {
    content: '';
    flex: 1;
    height: 1px;
    background: #E0E0E0;
  }

  .nw-fc-admin-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 6px 0;
    font-size: 0.85em;
    color: var(--_nw-color-text-subtle);
  }

  .nw-fc-admin-label {
    font-weight: 600;
    color: #9E9E9E;
  }

  .nw-fc-admin-value {
    font-weight: 500;
  }

  .nw-fc-admin-value a {
    color: var(--_nw-color-primary);
    text-decoration: none;
  }

  .nw-fc-admin-value a:hover {
    text-decoration: underline;
  }

  .nw-fc-mp-link {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-top: var(--_nw-space-2);
    padding: var(--_nw-space-2) var(--_nw-space-4);
    background: var(--_nw-color-secondary);
    color: var(--_nw-color-on-primary);
    border-radius: 6px;
    font-size: 0.82em;
    font-weight: 600;
    text-decoration: none;
    transition: background 0.15s;
  }

  .nw-fc-mp-link:hover {
    background: var(--_nw-color-primary);
  }

  /* ── Modal Responsive ── */

  @media (max-width: 600px) {
    .nw-fc-modal {
      max-height: 85vh;
    }
  }
`;

// ── 7. Agenda List Styles ──────────────────────────────────────────────────
// Custom agenda-style list view with date group headers, event rows with
// thumbnails, time/location meta, type badges, and a chevron arrow.

export const LIST_STYLES = `
  /* ── Agenda List ── */

  .nw-fc-agenda {
    display: flex;
    flex-direction: column;
    gap: 0;
  }

  .nw-fc-agenda-empty {
    text-align: center;
    padding: 60px var(--_nw-space-6);
    color: #9E9E9E;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--_nw-space-3);
  }

  .nw-fc-agenda-empty p {
    margin: 0;
    font-size: 0.95em;
  }

  /* ── Date Group ── */

  .nw-fc-agenda-group {
    margin-bottom: var(--_nw-space-1);
  }

  .nw-fc-agenda-date-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px var(--_nw-space-4);
    background: var(--_nw-color-surface-muted);
    border-bottom: 1px solid #E0E0E0;
    position: sticky;
    top: 0;
    z-index: 1;
  }

  .nw-fc-agenda-date-header.nw-fc-agenda-today {
    background: #D6F0FC;
    border-bottom-color: #9DD9F5;
  }

  .nw-fc-agenda-date-label {
    font-size: 0.85em;
    font-weight: var(--_nw-font-weight-heading);
    color: var(--_nw-color-secondary);
    letter-spacing: 0.01em;
  }

  .nw-fc-agenda-today .nw-fc-agenda-date-label {
    color: var(--_nw-color-primary);
  }

  .nw-fc-agenda-count {
    font-size: 0.72em;
    font-weight: 600;
    color: #9E9E9E;
    background: var(--_nw-color-surface);
    padding: 2px 10px;
    border-radius: 999px;
    border: 1px solid #E0E0E0;
  }

  .nw-fc-agenda-today .nw-fc-agenda-count {
    background: var(--_nw-color-surface);
    border-color: #9DD9F5;
    color: var(--_nw-color-primary);
  }

  /* ── Event Row ── */

  .nw-fc-agenda-row {
    display: flex;
    align-items: center;
    gap: var(--_nw-space-3);
    padding: var(--_nw-space-3) var(--_nw-space-4);
    border: none;
    border-bottom: var(--_nw-border-width) solid var(--_nw-color-surface-muted);
    background: var(--_nw-color-surface);
    cursor: pointer;
    transition: background 0.15s;
    width: 100%;
    text-align: left;
    font-family: inherit;
    font-size: inherit;
  }

  .nw-fc-agenda-row:hover {
    background: #f9fafb;
  }

  .nw-fc-agenda-row:active {
    background: #D6F0FC;
  }

  .nw-fc-agenda-row:last-child {
    border-bottom: none;
  }

  /* ── Color Accent Bar ── */

  .nw-fc-agenda-accent {
    width: 4px;
    align-self: stretch;
    border-radius: 2px;
    flex-shrink: 0;
  }

  /* ── Thumbnail ── */

  .nw-fc-agenda-thumb {
    width: 56px;
    height: 56px;
    border-radius: var(--_nw-radius);
    overflow: hidden;
    flex-shrink: 0;
  }

  .nw-fc-agenda-thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .nw-fc-agenda-thumb-placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
  }

  /* ── Content ── */

  .nw-fc-agenda-content {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .nw-fc-agenda-title {
    font-size: 0.92em;
    font-weight: var(--_nw-font-weight-heading);
    color: var(--_nw-color-text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .nw-fc-agenda-meta {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 0.78em;
    color: #9E9E9E;
  }

  .nw-fc-agenda-time {
    display: inline-flex;
    align-items: center;
    gap: var(--_nw-space-1);
    font-weight: 500;
    color: var(--_nw-color-text-subtle);
  }

  .nw-fc-agenda-campus {
    font-weight: 600;
    color: var(--_nw-color-primary);
    text-transform: uppercase;
    letter-spacing: 0.03em;
    font-size: 0.95em;
  }

  .nw-fc-agenda-location {
    display: inline-flex;
    align-items: center;
    gap: var(--_nw-space-1);
    font-size: 0.75em;
    color: #9E9E9E;
  }

  /* ── Badges ── */

  .nw-fc-agenda-badges {
    display: flex;
    flex-direction: column;
    gap: var(--_nw-space-1);
    align-items: flex-end;
    flex-shrink: 0;
  }

  .nw-fc-agenda-badge {
    display: inline-block;
    padding: 2px var(--_nw-space-2);
    border-radius: 999px;
    font-size: 0.65em;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--_nw-color-on-primary);
    white-space: nowrap;
  }

  .nw-fc-agenda-badge-featured {
    background: var(--_nw-color-accent) !important;
    color: var(--_nw-color-text) !important;
  }

  /* ── Chevron ── */

  .nw-fc-agenda-chevron {
    flex-shrink: 0;
    color: #E0E0E0;
    display: flex;
    align-items: center;
  }

  .nw-fc-agenda-row:hover .nw-fc-agenda-chevron {
    color: #9E9E9E;
  }

  /* ── Responsive ── */

  @media (max-width: 600px) {
    .nw-fc-agenda-thumb {
      width: 44px;
      height: 44px;
    }

    .nw-fc-agenda-row {
      padding: 10px var(--_nw-space-3);
      gap: var(--_nw-space-2);
    }

    .nw-fc-agenda-badges {
      display: none;
    }
  }
`;

// ── 8. Month Layout Styles ──────────────────────────────────────────────────
// Full-width mini calendar with larger cells for the "Month" view,
// plus a card grid below it.

export const MONTH_LAYOUT_STYLES = `
  /* ── Month Layout ── */

  .nw-fc-month-layout {
    display: flex;
    flex-direction: column;
    gap: var(--_nw-space-6);
  }

  .nw-fc-month-layout .nw-fc-mini-cal {
    max-width: 100%;
  }

  .nw-fc-month-layout .nw-fc-mini-cal-grid {
    gap: var(--_nw-space-1);
  }

  .nw-fc-month-layout .nw-fc-mini-cal-day {
    font-size: 0.9em;
    min-height: 48px;
    padding: 6px 0;
  }

  .nw-fc-month-layout .nw-fc-mini-cal-dow {
    font-size: 0.75em;
    padding: 6px var(--_nw-space-1);
  }

  .nw-fc-month-layout .nw-fc-mini-cal-header {
    margin-bottom: var(--_nw-space-4);
  }

  .nw-fc-month-layout .nw-fc-mini-cal-title {
    font-size: 1.1em;
  }

  .nw-fc-month-layout .nw-fc-density-dot {
    width: 6px;
    height: 6px;
  }

  .nw-fc-month-layout .nw-fc-mini-day-num {
    font-size: 1em;
  }

  .nw-fc-month-layout .nw-fc-mini-cal-day.today .nw-fc-mini-day-num {
    width: 28px;
    height: 28px;
  }
`;

// ── Combined Export ──────────────────────────────────────────────────────────
// Single constant that concatenates every section for convenient one-shot
// injection into the Shadow DOM.

export const ALL_STYLES = HEADING_RESET_STYLES + BASE_STYLES + TOOLBAR_STYLES + CARDS_STYLES + FILTER_STYLES + MINI_CAL_STYLES + MODAL_STYLES + LIST_STYLES + MONTH_LAYOUT_STYLES;
