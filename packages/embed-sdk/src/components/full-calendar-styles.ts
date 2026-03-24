// ────────────────────────────────────────────────────────────────────────────
// full-calendar-styles.ts
// All CSS style constants for the <next-full-calendar> widget.
// ────────────────────────────────────────────────────────────────────────────

// ── 1. Base Styles ──────────────────────────────────────────────────────────
// Host, container, loading/error states, spinner, FullCalendar brand
// overrides (toolbar, today cell, event pills, list view, now indicator,
// column headers, popover) and responsive tweaks for the FC built-in UI.

export const BASE_STYLES = `
  :host {
    display: block;
    font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
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
    gap: 12px;
    padding: 60px 24px;
    color: #9E9E9E;
    text-align: center;
  }

  .nw-fc-error {
    color: #991b1b;
  }

  .nw-fc-error svg {
    color: #FF6D6A;
  }

  .nw-fc-loading p {
    font-size: 15px;
    margin: 0;
  }

  .nw-fc-spinner {
    width: 32px;
    height: 32px;
    border: 3px solid #E0E0E0;
    border-top-color: #004C97;
    border-radius: 50%;
    animation: nw-fc-spin 0.75s linear infinite;
  }

  @keyframes nw-fc-spin {
    to { transform: rotate(360deg); }
  }

  /* ── FullCalendar CSS Variable Overrides ── */
  /* Must be on .fc (not :host) so they cascade into FC's cloned styles in Shadow DOM */

  .fc {
    --fc-button-bg-color: #004C97;
    --fc-button-border-color: #004C97;
    --fc-button-hover-bg-color: #002855;
    --fc-button-hover-border-color: #002855;
    --fc-button-active-bg-color: #002855;
    --fc-button-active-border-color: #002855;
    --fc-event-bg-color: #004C97;
    --fc-event-border-color: #004C97;
    --fc-event-selected-overlay-color: rgba(0, 40, 85, 0.25);
    --fc-bg-event-color: #D6F0FC;
    --fc-bg-event-opacity: 0.5;
    --fc-highlight-color: rgba(0, 76, 151, 0.1);
    --fc-today-bg-color: #D6F0FC;
    --fc-now-indicator-color: #FF6D6A;
    --fc-non-business-color: rgba(0, 0, 0, 0.03);
    --fc-neutral-bg-color: #f9fafb;
    --fc-page-bg-color: white;
    --fc-border-color: #E0E0E0;
    --fc-list-event-hover-bg-color: #D6F0FC;
  }

  /* ── FullCalendar Brand Overrides ── */

  /* Toolbar */
  .fc .fc-toolbar-title {
    font-size: 1.2em;
    font-weight: 700;
    color: #002855;
  }

  .fc .fc-button {
    background-color: #004C97;
    border-color: #004C97;
    font-size: 0.82em;
    font-weight: 600;
    padding: 5px 12px;
    border-radius: 6px;
    transition: background-color 0.15s ease, border-color 0.15s ease;
  }

  .fc .fc-button:hover {
    background-color: #002855;
    border-color: #002855;
  }

  .fc .fc-button:disabled {
    background-color: #9E9E9E;
    border-color: #9E9E9E;
    opacity: 0.6;
  }

  .fc .fc-button-primary:not(:disabled).fc-button-active,
  .fc .fc-button-primary:not(:disabled):active {
    background-color: #002855;
    border-color: #002855;
  }

  /* Today cell */
  .fc .fc-day-today {
    background-color: #D6F0FC !important;
  }

  .fc .fc-day-today .fc-daygrid-day-number {
    color: #004C97;
    font-weight: 700;
    background-color: #004C97;
    color: white;
    border-radius: 50%;
    width: 26px;
    height: 26px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  /* Event pills */
  .fc-event {
    border-radius: 4px;
    border: none !important;
    font-size: 0.78em;
    font-weight: 600;
    padding: 1px 5px;
    cursor: pointer;
    transition: opacity 0.15s ease, transform 0.1s ease;
  }

  .fc-event:hover {
    opacity: 0.85;
    transform: translateY(-1px);
  }

  /* List view */
  .fc .fc-list-event:hover td {
    background-color: #D6F0FC;
  }

  .fc .fc-list-event-dot {
    border-color: #004C97;
  }

  .fc .fc-daygrid-event-dot {
    border-color: #004C97 !important;
  }

  /* Now indicator */
  .fc .fc-timegrid-now-indicator-line {
    border-color: #FF6D6A;
  }

  .fc .fc-timegrid-now-indicator-arrow {
    border-top-color: #FF6D6A;
    border-bottom-color: #FF6D6A;
  }

  /* Column/day headers */
  .fc .fc-col-header-cell-cushion {
    font-weight: 600;
    color: #474747;
    font-size: 0.82em;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  /* Popover (more events) */
  .fc .fc-popover {
    border-radius: 8px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.12);
    border: 1px solid #E0E0E0;
  }

  .fc .fc-popover-header {
    background: #004C97;
    color: white;
    border-radius: 8px 8px 0 0;
    font-weight: 600;
    font-size: 0.85em;
  }

  /* ── Responsive (FC built-in) ── */

  @media (max-width: 600px) {
    .fc .fc-toolbar {
      flex-wrap: wrap;
      gap: 8px;
    }

    .fc .fc-toolbar-title {
      font-size: 1em;
    }

    .fc .fc-button {
      font-size: 0.75em;
      padding: 4px 8px;
    }
  }
`;

// ── 2. Toolbar Styles ───────────────────────────────────────────────────────
// Custom toolbar that replaces FullCalendar's built-in toolbar with branded
// prev/next/today buttons, a centered title, and view-switching buttons.

export const TOOLBAR_STYLES = `
  /* ── Custom Toolbar ── */

  .nw-fc-toolbar {
    display: flex;
    flex-direction: row;
    justify-content: space-between;
    align-items: center;
    padding: 8px 0;
    margin-bottom: 16px;
    flex-wrap: wrap;
  }

  .nw-fc-toolbar-left {
    display: flex;
    flex-direction: row;
    gap: 4px;
  }

  .nw-fc-toolbar-center {
    font-size: 1.2em;
    font-weight: 700;
    color: #002855;
  }

  .nw-fc-toolbar-right {
    display: flex;
    flex-direction: row;
    gap: 4px;
  }

  .nw-fc-toolbar-btn {
    background: white;
    border: 1px solid #E0E0E0;
    border-radius: 6px;
    padding: 6px 14px;
    font-size: 0.82em;
    font-weight: 600;
    color: #474747;
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s, color 0.15s;
  }

  .nw-fc-toolbar-btn:hover {
    background: #f3f4f6;
    border-color: #9E9E9E;
  }

  .nw-fc-toolbar-btn.active {
    background: #004C97;
    color: white;
    border-color: #004C97;
  }

  .nw-fc-toolbar-btn.active:hover {
    background: #002855;
  }

  .nw-fc-toolbar-nav {
    background: white;
    border: 1px solid #E0E0E0;
    border-radius: 6px;
    padding: 6px 14px;
    font-size: 0.82em;
    font-weight: 600;
    color: #474747;
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s, color 0.15s;
    width: 36px;
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .nw-fc-toolbar-nav:hover {
    background: #f3f4f6;
    border-color: #9E9E9E;
  }

  /* ── Toolbar Responsive ── */

  @media (max-width: 600px) {
    .nw-fc-toolbar {
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 12px;
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
    gap: 24px;
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
    background: white;
    border-radius: 8px;
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
    background: #f3f4f6;
  }

  .nw-fc-card-image img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .nw-fc-card-placeholder {
    width: 100%;
    height: 100%;
    background: #004C97;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  /* ── Card Date Block (dark navy overlay) ── */

  .nw-fc-card-date-block {
    position: absolute;
    bottom: 0;
    left: 0;
    background: #002855;
    padding: 8px 14px;
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
    color: white;
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
    padding: 14px 16px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    flex: 1;
  }

  .nw-fc-card-info {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .nw-fc-card-time {
    font-size: 0.82em;
    color: #474747;
    font-weight: 500;
  }

  .nw-fc-card-campus {
    font-size: 0.82em;
    color: #474747;
    font-weight: 500;
  }

  .nw-fc-card-campus::before {
    content: '|';
    margin-right: 8px;
    color: #E0E0E0;
  }

  .nw-fc-card-title {
    font-size: 1.05em;
    font-weight: 600;
    color: #004C97;
    margin: 4px 0 2px;
    line-height: 1.3;
  }

  /* ── Card CTA (full-width dark bar) ── */

  .nw-fc-card-learn-more {
    display: block;
    width: 100%;
    padding: 12px;
    background: #002855;
    color: white;
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
    background: #004C97;
  }

  /* ── Show More ── */

  .nw-fc-show-more {
    display: block;
    margin: 24px auto 0;
    padding: 10px 32px;
    background: white;
    border: 2px solid #004C97;
    color: #004C97;
    border-radius: 8px;
    font-size: 0.9em;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s;
  }

  .nw-fc-show-more:hover {
    background: #004C97;
    color: white;
  }

  /* ── Cards Empty ── */

  .nw-fc-cards-empty {
    text-align: center;
    padding: 60px 24px;
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
    gap: 12px;
    margin-bottom: 24px;
  }

  .nw-fc-filter-section {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
  }

  .nw-fc-filter-label {
    font-size: 0.8em;
    font-weight: 700;
    color: #474747;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    min-width: 70px;
  }

  .nw-fc-filter-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 5px 14px;
    border-radius: 999px;
    font-size: 0.8em;
    font-weight: 600;
    cursor: pointer;
    border: 1.5px solid #004C97;
    color: #004C97;
    background: white;
    transition: all 0.15s;
    user-select: none;
  }

  .nw-fc-filter-chip:hover {
    background: #D6F0FC;
  }

  .nw-fc-filter-chip.active {
    background: #004C97;
    color: white;
    border-color: #004C97;
  }

  .nw-fc-filter-chip.active:hover {
    background: #002855;
    border-color: #002855;
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
    gap: 24px;
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
    background: white;
    border-radius: 12px;
    border: 1px solid #E0E0E0;
    padding: 16px;
  }

  .nw-fc-mini-cal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;
  }

  .nw-fc-mini-cal-title {
    font-size: 0.95em;
    font-weight: 700;
    color: #002855;
  }

  .nw-fc-mini-cal-nav {
    background: none;
    border: none;
    cursor: pointer;
    padding: 4px;
    color: #474747;
    font-size: 16px;
    border-radius: 4px;
  }

  .nw-fc-mini-cal-nav:hover {
    background: #f3f4f6;
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
    padding: 4px;
    text-transform: uppercase;
  }

  .nw-fc-mini-cal-day {
    font-size: 0.82em;
    padding: 4px 0;
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
    background: #f3f4f6;
  }

  .nw-fc-mini-cal-day.today .nw-fc-mini-day-num {
    background: #004C97;
    color: white;
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
    background: #002855;
  }

  /* ── Today Link ── */

  .nw-fc-mini-cal-today-link {
    display: block;
    text-align: center;
    margin-top: 8px;
    font-size: 0.8em;
    color: #004C97;
    cursor: pointer;
    font-weight: 600;
  }

  .nw-fc-mini-cal-today-link:hover {
    text-decoration: underline;
  }

  /* ── Density Legend ── */

  .nw-fc-density-legend {
    display: flex;
    gap: 12px;
    justify-content: center;
    margin-top: 12px;
    font-size: 0.7em;
    color: #9E9E9E;
  }

  .nw-fc-legend-item {
    display: flex;
    align-items: center;
    gap: 4px;
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
    padding: 16px;
    opacity: 0;
    transition: opacity 0.2s ease;
    box-sizing: border-box;
  }

  .nw-fc-modal-overlay.nw-fc-modal-visible {
    opacity: 1;
  }

  .nw-fc-modal {
    background: white;
    border-radius: 12px;
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
    padding: 20px 20px 16px 20px;
    border-bottom: 1px solid #E0E0E0;
    padding-left: 24px;
  }

  .nw-fc-modal-title-row {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 10px;
  }

  .nw-fc-modal-title {
    font-size: 1.15em;
    font-weight: 700;
    color: #2D2926;
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
    color: #2D2926;
  }

  .nw-fc-modal-badges {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 4px;
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
    color: white;
  }

  .nw-fc-badge-type {
    /* background set inline via event color */
  }

  .nw-fc-badge-campus {
    background-color: #002855;
  }

  .nw-fc-badge-featured {
    background-color: #F1BE48;
    color: #2D2926;
  }

  .nw-fc-modal-body {
    padding: 16px 20px 20px 20px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .nw-fc-modal-meta-row {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    color: #474747;
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
    padding-top: 12px;
    border-top: 1px solid #E0E0E0;
    color: #474747;
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
    margin-top: 12px;
    padding-top: 16px;
    border-top: 1px solid #E0E0E0;
  }

  .nw-fc-register-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 10px 24px;
    background-color: #004C97;
    color: white;
    font-size: 0.9em;
    font-weight: 600;
    border-radius: 8px;
    text-decoration: none;
    transition: background-color 0.15s ease;
    cursor: pointer;
  }

  .nw-fc-register-btn:hover {
    background-color: #002855;
  }

  /* ── Modal Image ── */

  .nw-fc-modal-image {
    width: 100%;
    aspect-ratio: 16 / 9;
    object-fit: cover;
    display: block;
    border-radius: 12px 12px 0 0;
  }

  .nw-fc-modal-image-placeholder {
    width: 100%;
    aspect-ratio: 16 / 9;
    background: #004C97;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 12px 12px 0 0;
  }

  /* ── Admin Section ── */

  .nw-fc-admin-section {
    margin-top: 12px;
    padding: 16px;
    background: #f9fafb;
    border-radius: 8px;
    border: 1px solid #E0E0E0;
  }

  .nw-fc-admin-divider {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 12px;
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
    color: #474747;
  }

  .nw-fc-admin-label {
    font-weight: 600;
    color: #9E9E9E;
  }

  .nw-fc-admin-value {
    font-weight: 500;
  }

  .nw-fc-admin-value a {
    color: #004C97;
    text-decoration: none;
  }

  .nw-fc-admin-value a:hover {
    text-decoration: underline;
  }

  .nw-fc-mp-link {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-top: 8px;
    padding: 8px 16px;
    background: #002855;
    color: white;
    border-radius: 6px;
    font-size: 0.82em;
    font-weight: 600;
    text-decoration: none;
    transition: background 0.15s;
  }

  .nw-fc-mp-link:hover {
    background: #004C97;
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
    padding: 60px 24px;
    color: #9E9E9E;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
  }

  .nw-fc-agenda-empty p {
    margin: 0;
    font-size: 0.95em;
  }

  /* ── Date Group ── */

  .nw-fc-agenda-group {
    margin-bottom: 4px;
  }

  .nw-fc-agenda-date-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 16px;
    background: #f3f4f6;
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
    font-weight: 700;
    color: #002855;
    letter-spacing: 0.01em;
  }

  .nw-fc-agenda-today .nw-fc-agenda-date-label {
    color: #004C97;
  }

  .nw-fc-agenda-count {
    font-size: 0.72em;
    font-weight: 600;
    color: #9E9E9E;
    background: white;
    padding: 2px 10px;
    border-radius: 999px;
    border: 1px solid #E0E0E0;
  }

  .nw-fc-agenda-today .nw-fc-agenda-count {
    background: white;
    border-color: #9DD9F5;
    color: #004C97;
  }

  /* ── Event Row ── */

  .nw-fc-agenda-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 16px;
    border: none;
    border-bottom: 1px solid #f3f4f6;
    background: white;
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
    border-radius: 8px;
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
    font-weight: 700;
    color: #2D2926;
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
    gap: 4px;
    font-weight: 500;
    color: #474747;
  }

  .nw-fc-agenda-campus {
    font-weight: 600;
    color: #004C97;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    font-size: 0.95em;
  }

  .nw-fc-agenda-location {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 0.75em;
    color: #9E9E9E;
  }

  /* ── Badges ── */

  .nw-fc-agenda-badges {
    display: flex;
    flex-direction: column;
    gap: 4px;
    align-items: flex-end;
    flex-shrink: 0;
  }

  .nw-fc-agenda-badge {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 999px;
    font-size: 0.65em;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: white;
    white-space: nowrap;
  }

  .nw-fc-agenda-badge-featured {
    background: #F1BE48 !important;
    color: #2D2926 !important;
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
      padding: 10px 12px;
      gap: 8px;
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
    gap: 24px;
  }

  .nw-fc-month-layout .nw-fc-mini-cal {
    max-width: 100%;
  }

  .nw-fc-month-layout .nw-fc-mini-cal-grid {
    gap: 4px;
  }

  .nw-fc-month-layout .nw-fc-mini-cal-day {
    font-size: 0.9em;
    min-height: 48px;
    padding: 6px 0;
  }

  .nw-fc-month-layout .nw-fc-mini-cal-dow {
    font-size: 0.75em;
    padding: 6px 4px;
  }

  .nw-fc-month-layout .nw-fc-mini-cal-header {
    margin-bottom: 16px;
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

export const ALL_STYLES = BASE_STYLES + TOOLBAR_STYLES + CARDS_STYLES + FILTER_STYLES + MINI_CAL_STYLES + MODAL_STYLES + LIST_STYLES + MONTH_LAYOUT_STYLES;
