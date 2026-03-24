// ── Interfaces ──

export interface CalendarEvent {
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

export interface CalendarFilter {
  id: number;
  name: string;
}

export interface ActiveFilters {
  campusIds: Set<number>;
  ministryNames: Set<string>;
}

// ── Private Helpers ──

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatCardTime(startDate: string, endDate: string): string {
  const start = new Date(startDate);
  const end = new Date(endDate);

  const opts: Intl.DateTimeFormatOptions = {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  };

  const startStr = start.toLocaleTimeString("en-US", opts);
  const endStr = end.toLocaleTimeString("en-US", opts);

  return `${startStr} - ${endStr}`;
}

function formatCardDate(dateStr: string): { dow: string; day: string; month: string } {
  const date = new Date(dateStr);

  const dow = date
    .toLocaleDateString("en-US", { weekday: "long" })
    .toUpperCase();

  const day = String(date.getDate());

  const month = date
    .toLocaleDateString("en-US", { month: "short" })
    .toUpperCase();

  return { dow, day, month };
}

// ── Exported Functions ──

/**
 * Renders campus and ministry filter chips.
 */
export function renderFilterChips(
  filters: { campuses: CalendarFilter[]; ministries: CalendarFilter[] },
  activeFilters: ActiveFilters,
  onFilterChange: (filters: ActiveFilters) => void
): HTMLElement {
  const container = document.createElement("div");
  container.className = "nw-fc-filters";

  // ── Campus section ──
  if (filters.campuses.length > 0) {
    const section = document.createElement("div");
    section.className = "nw-fc-filter-section";

    const label = document.createElement("span");
    label.className = "nw-fc-filter-label";
    label.textContent = "Campus";
    section.appendChild(label);

    // "All" chip
    const allChip = document.createElement("button");
    allChip.className = "nw-fc-filter-chip";
    if (activeFilters.campusIds.size === 0) {
      allChip.classList.add("active");
    }
    allChip.innerHTML =
      activeFilters.campusIds.size === 0
        ? `<svg class="nw-fc-chip-check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> All`
        : "All";
    allChip.addEventListener("click", () => {
      const next: ActiveFilters = {
        campusIds: new Set<number>(),
        ministryNames: new Set(activeFilters.ministryNames),
      };
      onFilterChange(next);
    });
    section.appendChild(allChip);

    // Individual campus chips
    for (const campus of filters.campuses) {
      const chip = document.createElement("button");
      chip.className = "nw-fc-filter-chip";
      const isActive = activeFilters.campusIds.has(campus.id);
      if (isActive) {
        chip.classList.add("active");
      }
      chip.innerHTML = isActive
        ? `<svg class="nw-fc-chip-check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> ${escapeHtml(campus.name)}`
        : escapeHtml(campus.name);
      chip.addEventListener("click", () => {
        const nextIds = new Set(activeFilters.campusIds);
        if (nextIds.has(campus.id)) {
          nextIds.delete(campus.id);
        } else {
          nextIds.add(campus.id);
        }
        const next: ActiveFilters = {
          campusIds: nextIds,
          ministryNames: new Set(activeFilters.ministryNames),
        };
        onFilterChange(next);
      });
      section.appendChild(chip);
    }

    container.appendChild(section);
  }

  // ── Ministry section ──
  if (filters.ministries.length > 0) {
    const section = document.createElement("div");
    section.className = "nw-fc-filter-section";

    const label = document.createElement("span");
    label.className = "nw-fc-filter-label";
    label.textContent = "Ministry";
    section.appendChild(label);

    // "All" chip
    const allChip = document.createElement("button");
    allChip.className = "nw-fc-filter-chip";
    if (activeFilters.ministryNames.size === 0) {
      allChip.classList.add("active");
    }
    allChip.innerHTML =
      activeFilters.ministryNames.size === 0
        ? `<svg class="nw-fc-chip-check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> All`
        : "All";
    allChip.addEventListener("click", () => {
      const next: ActiveFilters = {
        campusIds: new Set(activeFilters.campusIds),
        ministryNames: new Set<string>(),
      };
      onFilterChange(next);
    });
    section.appendChild(allChip);

    // Individual ministry chips
    for (const ministry of filters.ministries) {
      const chip = document.createElement("button");
      chip.className = "nw-fc-filter-chip";
      const isActive = activeFilters.ministryNames.has(ministry.name);
      if (isActive) {
        chip.classList.add("active");
      }
      chip.innerHTML = isActive
        ? `<svg class="nw-fc-chip-check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> ${escapeHtml(ministry.name)}`
        : escapeHtml(ministry.name);
      chip.addEventListener("click", () => {
        const nextNames = new Set(activeFilters.ministryNames);
        if (nextNames.has(ministry.name)) {
          nextNames.delete(ministry.name);
        } else {
          nextNames.add(ministry.name);
        }
        const next: ActiveFilters = {
          campusIds: new Set(activeFilters.campusIds),
          ministryNames: nextNames,
        };
        onFilterChange(next);
      });
      section.appendChild(chip);
    }

    container.appendChild(section);
  }

  return container;
}

/**
 * Filters events client-side based on active campus and ministry filters.
 * Both filters are AND'd: an event must match campus AND ministry if both are set.
 */
export function filterEvents(
  events: CalendarEvent[],
  activeFilters: ActiveFilters
): CalendarEvent[] {
  return events.filter((event) => {
    // Campus filter
    if (activeFilters.campusIds.size > 0) {
      if (
        event.Congregation_ID === null ||
        !activeFilters.campusIds.has(event.Congregation_ID)
      ) {
        return false;
      }
    }

    // Ministry filter
    if (activeFilters.ministryNames.size > 0) {
      if (
        event.Ministry_Name === null ||
        !activeFilters.ministryNames.has(event.Ministry_Name)
      ) {
        return false;
      }
    }

    return true;
  });
}

/**
 * Renders a paginated grid of event cards.
 *
 * @param events       Already-filtered events (will be sorted by start date ascending).
 * @param page         1-based page number; displays page * 12 events total.
 * @param onLearnMore  Callback when "LEARN MORE" is clicked on a card.
 * @param onShowMore   Callback when the "Show More" button is clicked.
 */
export function renderCardsGrid(
  events: CalendarEvent[],
  page: number,
  onLearnMore: (event: CalendarEvent) => void,
  onShowMore: () => void
): HTMLElement {
  const grid = document.createElement("div");
  grid.className = "nw-fc-cards-grid";

  // Sort by Event_Start_Date ascending
  const sorted = [...events].sort(
    (a, b) =>
      new Date(a.Event_Start_Date).getTime() -
      new Date(b.Event_Start_Date).getTime()
  );

  const visibleCount = page * 12;
  const visible = sorted.slice(0, visibleCount);

  if (visible.length === 0) {
    const empty = document.createElement("div");
    empty.className = "nw-fc-cards-empty";
    empty.textContent = "No events found";
    grid.appendChild(empty);
    return grid;
  }

  for (const event of visible) {
    const card = document.createElement("div");
    card.className = "nw-fc-card";

    // ── Card image ──
    const imageDiv = document.createElement("div");
    imageDiv.className = "nw-fc-card-image";

    if (event.Image_URL) {
      const img = document.createElement("img");
      img.src = event.Image_URL;
      img.alt = escapeHtml(event.Event_Title);
      img.loading = "lazy";
      imageDiv.appendChild(img);
    } else {
      const placeholder = document.createElement("div");
      placeholder.className = "nw-fc-card-placeholder";
      placeholder.innerHTML = `<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><rect x="7" y="14" width="3" height="3" rx="0.5"/><rect x="14" y="14" width="3" height="3" rx="0.5"/></svg>`;
      imageDiv.appendChild(placeholder);
    }

    // Date block overlay
    const dateInfo = formatCardDate(event.Event_Start_Date);
    const dateBlock = document.createElement("div");
    dateBlock.className = "nw-fc-card-date-block";

    const dowEl = document.createElement("span");
    dowEl.className = "nw-fc-date-dow";
    dowEl.textContent = dateInfo.dow;

    const dayEl = document.createElement("span");
    dayEl.className = "nw-fc-date-day";
    dayEl.textContent = dateInfo.day;

    const monthEl = document.createElement("span");
    monthEl.className = "nw-fc-date-month";
    monthEl.textContent = dateInfo.month;

    dateBlock.appendChild(dowEl);
    dateBlock.appendChild(dayEl);
    dateBlock.appendChild(monthEl);
    imageDiv.appendChild(dateBlock);

    card.appendChild(imageDiv);

    // ── Card body ──
    const body = document.createElement("div");
    body.className = "nw-fc-card-body";

    // Info row: time + campus
    const infoRow = document.createElement("div");
    infoRow.className = "nw-fc-card-info";

    const timeEl = document.createElement("span");
    timeEl.className = "nw-fc-card-time";
    timeEl.textContent = formatCardTime(
      event.Event_Start_Date,
      event.Event_End_Date
    );
    infoRow.appendChild(timeEl);

    if (event.Congregation_Name) {
      const campusEl = document.createElement("span");
      campusEl.className = "nw-fc-card-campus";
      campusEl.textContent = event.Congregation_Name;
      infoRow.appendChild(campusEl);
    }

    body.appendChild(infoRow);

    const titleEl = document.createElement("div");
    titleEl.className = "nw-fc-card-title";
    titleEl.textContent = event.Event_Title;
    body.appendChild(titleEl);

    card.appendChild(body);

    // ── Learn More bar (outside body, flush bottom) ──
    const learnMoreBtn = document.createElement("button");
    learnMoreBtn.className = "nw-fc-card-learn-more";
    learnMoreBtn.textContent = "LEARN MORE";
    learnMoreBtn.addEventListener("click", () => onLearnMore(event));
    card.appendChild(learnMoreBtn);

    grid.appendChild(card);
  }

  // Show more button if there are more events
  if (sorted.length > visibleCount) {
    const showMore = document.createElement("button");
    showMore.className = "nw-fc-show-more";
    showMore.textContent = "Show More";
    showMore.addEventListener("click", () => onShowMore());
    grid.appendChild(showMore);
  }

  return grid;
}
