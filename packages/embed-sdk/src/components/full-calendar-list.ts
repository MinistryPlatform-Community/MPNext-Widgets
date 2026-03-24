// ── Interfaces ──

interface CalendarEvent {
  Event_ID: number;
  Event_Title: string;
  Event_Start_Date: string;
  Event_End_Date: string;
  Event_Type_ID: number | null;
  Event_Type: string | null;
  Congregation_ID: number | null;
  Congregation_Name: string | null;
  Location_Name: string | null;
  Description: string | null;
  Featured_On_Calendar: boolean;
  Registration_URL: string | null;
  Image_URL: string | null;
  Program_ID: number | null;
  Program_Name: string | null;
  Ministry_Name: string | null;
  Primary_Contact_Name: string | null;
  Primary_Contact_Email: string | null;
  Primary_Contact_Phone: string | null;
  Participants_Expected: number | null;
  Participant_Count: number | null;
  Registration_Product_Name: string | null;
  MP_Detail_URL: string | null;
}

// ── Helpers ──

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function toDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatDateHeader(dateStr: string): string {
  const date = new Date(dateStr + "T00:00:00");
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  if (toDateKey(date) === toDateKey(today)) {
    return "Today";
  }
  if (toDateKey(date) === toDateKey(tomorrow)) {
    return "Tomorrow";
  }

  return date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function formatTime(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function formatTimeRange(startStr: string, endStr: string): string {
  return `${formatTime(startStr)} – ${formatTime(endStr)}`;
}

// Placeholder SVG for events without images
const PLACEHOLDER_SVG = `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`;

// Location pin SVG
const ICON_PIN = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`;

// Clock SVG
const ICON_CLOCK = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;

// ── Exported Functions ──

/**
 * Groups events by date and renders an agenda-style list.
 * Inspired by Pocket Platform / Display.Church "Detailed List" view.
 */
export function renderAgendaList(
  events: CalendarEvent[],
  onEventClick: (event: CalendarEvent) => void,
  getEventColor: (typeId: number | null) => string
): HTMLElement {
  const container = document.createElement("div");
  container.className = "nw-fc-agenda";

  if (events.length === 0) {
    container.innerHTML = `
      <div class="nw-fc-agenda-empty">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#9E9E9E" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="4" width="18" height="18" rx="2"/>
          <line x1="16" y1="2" x2="16" y2="6"/>
          <line x1="8" y1="2" x2="8" y2="6"/>
          <line x1="3" y1="10" x2="21" y2="10"/>
        </svg>
        <p>No events scheduled for this period.</p>
      </div>
    `;
    return container;
  }

  // Group events by date (YYYY-MM-DD)
  const grouped = new Map<string, CalendarEvent[]>();
  for (const event of events) {
    const key = event.Event_Start_Date.slice(0, 10);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(event);
  }

  // Render each date group
  for (const [dateKey, dayEvents] of grouped) {
    const group = document.createElement("div");
    group.className = "nw-fc-agenda-group";

    // Sticky date header
    const header = document.createElement("div");
    header.className = "nw-fc-agenda-date-header";

    const today = toDateKey(new Date());
    if (dateKey === today) {
      header.classList.add("nw-fc-agenda-today");
    }

    const dateLabel = document.createElement("span");
    dateLabel.className = "nw-fc-agenda-date-label";
    dateLabel.textContent = formatDateHeader(dateKey);
    header.appendChild(dateLabel);

    const countBadge = document.createElement("span");
    countBadge.className = "nw-fc-agenda-count";
    countBadge.textContent = `${dayEvents.length} event${dayEvents.length > 1 ? "s" : ""}`;
    header.appendChild(countBadge);

    group.appendChild(header);

    // Event rows
    for (const event of dayEvents) {
      const row = document.createElement("button");
      row.className = "nw-fc-agenda-row";
      row.type = "button";
      row.setAttribute("aria-label", event.Event_Title);

      const color = getEventColor(event.Event_Type_ID);

      // Color accent bar
      const accent = document.createElement("div");
      accent.className = "nw-fc-agenda-accent";
      accent.style.backgroundColor = color;
      row.appendChild(accent);

      // Thumbnail
      const thumb = document.createElement("div");
      thumb.className = "nw-fc-agenda-thumb";
      if (event.Image_URL) {
        const img = document.createElement("img");
        img.src = event.Image_URL;
        img.alt = "";
        img.loading = "lazy";
        thumb.appendChild(img);
      } else {
        thumb.classList.add("nw-fc-agenda-thumb-placeholder");
        thumb.style.backgroundColor = color;
        thumb.innerHTML = PLACEHOLDER_SVG;
      }
      row.appendChild(thumb);

      // Content
      const content = document.createElement("div");
      content.className = "nw-fc-agenda-content";

      // Title
      const title = document.createElement("div");
      title.className = "nw-fc-agenda-title";
      title.textContent = event.Event_Title;
      content.appendChild(title);

      // Meta line: time + campus
      const meta = document.createElement("div");
      meta.className = "nw-fc-agenda-meta";

      const timeSpan = document.createElement("span");
      timeSpan.className = "nw-fc-agenda-time";
      timeSpan.innerHTML = `${ICON_CLOCK} ${escapeHtml(formatTimeRange(event.Event_Start_Date, event.Event_End_Date))}`;
      meta.appendChild(timeSpan);

      if (event.Congregation_Name) {
        const campusSpan = document.createElement("span");
        campusSpan.className = "nw-fc-agenda-campus";
        campusSpan.textContent = event.Congregation_Name;
        meta.appendChild(campusSpan);
      }

      content.appendChild(meta);

      // Location line
      if (event.Location_Name) {
        const loc = document.createElement("div");
        loc.className = "nw-fc-agenda-location";
        loc.innerHTML = `${ICON_PIN} ${escapeHtml(event.Location_Name)}`;
        content.appendChild(loc);
      }

      row.appendChild(content);

      // Badges (right side)
      const badges = document.createElement("div");
      badges.className = "nw-fc-agenda-badges";

      if (event.Event_Type) {
        const badge = document.createElement("span");
        badge.className = "nw-fc-agenda-badge";
        badge.style.backgroundColor = color;
        badge.textContent = event.Event_Type;
        badges.appendChild(badge);
      }

      if (event.Featured_On_Calendar) {
        const featured = document.createElement("span");
        featured.className = "nw-fc-agenda-badge nw-fc-agenda-badge-featured";
        featured.textContent = "Featured";
        badges.appendChild(featured);
      }

      row.appendChild(badges);

      // Chevron
      const chevron = document.createElement("div");
      chevron.className = "nw-fc-agenda-chevron";
      chevron.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`;
      row.appendChild(chevron);

      row.addEventListener("click", () => onEventClick(event));
      group.appendChild(row);
    }

    container.appendChild(group);
  }

  return container;
}
