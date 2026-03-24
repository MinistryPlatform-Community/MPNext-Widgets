// ── Types ──

export interface EventCountMap {
  [dateKey: string]: number; // key format: "YYYY-MM-DD", value: event count
}

interface MiniCalendarOptions {
  currentMonth: Date;
  eventsByDate: EventCountMap;
  selectedDate: string | null;
  onDateClick: (dateKey: string) => void;
  onMonthChange: (newMonth: Date) => void;
}

// ── Helpers (module-private) ──

function formatMonthYear(date: Date): string {
  return date.toLocaleString("en-US", { month: "long", year: "numeric" });
}

function toDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfWeek(year: number, month: number): number {
  return new Date(year, month, 1).getDay(); // 0 = Sunday
}

// ── Exported Functions ──

/**
 * Returns the number of density dots for a given event count.
 * 0 -> 0, 1-3 -> 1, 4-6 -> 2, 7+ -> 3
 */
export function getDensityDotCount(count: number): number {
  if (count <= 0) return 0;
  if (count <= 3) return 1;
  if (count <= 6) return 2;
  return 3;
}

/**
 * Builds an EventCountMap from an array of events.
 * Multi-day events add a count to each day they span.
 */
export function buildEventCountMap(
  events: Array<{ Event_Start_Date: string; Event_End_Date: string }>
): EventCountMap {
  const map: EventCountMap = {};

  for (const event of events) {
    const startStr = event.Event_Start_Date.substring(0, 10); // "YYYY-MM-DD"
    const endStr = event.Event_End_Date.substring(0, 10);

    const start = new Date(startStr + "T00:00:00");
    const end = new Date(endStr + "T00:00:00");

    // Walk each day from start to end (inclusive)
    const cursor = new Date(start);
    while (cursor <= end) {
      const key = toDateKey(cursor);
      map[key] = (map[key] || 0) + 1;
      cursor.setDate(cursor.getDate() + 1);
    }
  }

  return map;
}

/**
 * Renders a mini calendar element with density dots.
 * Pure vanilla TS -- no framework dependencies.
 */
export function renderMiniCalendar(options: MiniCalendarOptions): HTMLElement {
  const { currentMonth, eventsByDate, selectedDate, onDateClick, onMonthChange } = options;

  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const today = new Date();
  const todayKey = toDateKey(today);

  // ── Root container ──
  const root = document.createElement("div");
  root.className = "nw-fc-mini-cal";

  // ── Header ──
  const header = document.createElement("div");
  header.className = "nw-fc-mini-cal-header";

  const prevBtn = document.createElement("button");
  prevBtn.className = "nw-fc-mini-cal-nav";
  prevBtn.setAttribute("aria-label", "Previous month");
  prevBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>`;
  prevBtn.addEventListener("click", () => {
    onMonthChange(new Date(year, month - 1, 1));
  });

  const title = document.createElement("span");
  title.className = "nw-fc-mini-cal-title";
  title.textContent = formatMonthYear(new Date(year, month, 1));

  const nextBtn = document.createElement("button");
  nextBtn.className = "nw-fc-mini-cal-nav";
  nextBtn.setAttribute("aria-label", "Next month");
  nextBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>`;
  nextBtn.addEventListener("click", () => {
    onMonthChange(new Date(year, month + 1, 1));
  });

  header.appendChild(prevBtn);
  header.appendChild(title);
  header.appendChild(nextBtn);
  root.appendChild(header);

  // ── Day-of-week headers + Day cells (single grid) ──
  const grid = document.createElement("div");
  grid.className = "nw-fc-mini-cal-grid";

  const dowLabels = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
  for (const label of dowLabels) {
    const dow = document.createElement("span");
    dow.className = "nw-fc-mini-cal-dow";
    dow.textContent = label;
    grid.appendChild(dow);
  }

  // Leading days from previous month
  const firstDow = getFirstDayOfWeek(year, month);
  const prevMonthDays = getDaysInMonth(
    month === 0 ? year - 1 : year,
    month === 0 ? 11 : month - 1
  );

  for (let i = firstDow - 1; i >= 0; i--) {
    const dayNum = prevMonthDays - i;
    const prevYear = month === 0 ? year - 1 : year;
    const prevMonth = month === 0 ? 11 : month - 1;
    const dateKey = toDateKey(new Date(prevYear, prevMonth, dayNum));
    const cell = createDayCell(dayNum, dateKey, eventsByDate, todayKey, selectedDate, true, onDateClick);
    grid.appendChild(cell);
  }

  // Current month days
  const daysInMonth = getDaysInMonth(year, month);
  for (let d = 1; d <= daysInMonth; d++) {
    const dateKey = toDateKey(new Date(year, month, d));
    const cell = createDayCell(d, dateKey, eventsByDate, todayKey, selectedDate, false, onDateClick);
    grid.appendChild(cell);
  }

  // Trailing days from next month to fill the grid to a complete row
  const totalCellsSoFar = firstDow + daysInMonth;
  const remainder = totalCellsSoFar % 7;
  if (remainder > 0) {
    const trailingCount = 7 - remainder;
    const nextYear = month === 11 ? year + 1 : year;
    const nextMonth = month === 11 ? 0 : month + 1;
    for (let d = 1; d <= trailingCount; d++) {
      const dateKey = toDateKey(new Date(nextYear, nextMonth, d));
      const cell = createDayCell(d, dateKey, eventsByDate, todayKey, selectedDate, true, onDateClick);
      grid.appendChild(cell);
    }
  }

  root.appendChild(grid);

  // ── Today link ──
  const todayLink = document.createElement("button");
  todayLink.className = "nw-fc-mini-cal-today-link";
  todayLink.textContent = "Today";
  todayLink.addEventListener("click", () => {
    onDateClick(todayKey);
    onMonthChange(new Date(today.getFullYear(), today.getMonth(), 1));
  });
  root.appendChild(todayLink);

  // ── Density legend ──
  const legend = document.createElement("div");
  legend.className = "nw-fc-density-legend";

  const legendItems: [number, string][] = [
    [1, "1-3 events"],
    [2, "4-6 events"],
    [3, "7+ events"],
  ];

  for (const [dotCount, label] of legendItems) {
    const item = document.createElement("span");
    item.className = "nw-fc-legend-item";

    for (let i = 0; i < dotCount; i++) {
      const dot = document.createElement("span");
      dot.className = "nw-fc-density-dot";
      item.appendChild(dot);
    }

    const text = document.createElement("span");
    text.textContent = label;
    item.appendChild(text);

    legend.appendChild(item);
  }

  root.appendChild(legend);

  return root;
}

// ── Private DOM builder ──

function createDayCell(
  dayNum: number,
  dateKey: string,
  eventsByDate: EventCountMap,
  todayKey: string,
  selectedDate: string | null,
  isOtherMonth: boolean,
  onDateClick: (dateKey: string) => void
): HTMLElement {
  const cell = document.createElement("button");
  cell.className = "nw-fc-mini-cal-day";

  if (isOtherMonth) cell.classList.add("other-month");
  if (dateKey === todayKey) cell.classList.add("today");
  if (selectedDate && dateKey === selectedDate) cell.classList.add("selected");

  // Day number
  const numSpan = document.createElement("span");
  numSpan.className = "nw-fc-mini-day-num";
  numSpan.textContent = String(dayNum);
  cell.appendChild(numSpan);

  // Density dots
  const count = eventsByDate[dateKey] || 0;
  const dotCount = getDensityDotCount(count);
  if (dotCount > 0) {
    const dotsDiv = document.createElement("div");
    dotsDiv.className = "nw-fc-density-dots";
    for (let i = 0; i < dotCount; i++) {
      const dot = document.createElement("span");
      dot.className = "nw-fc-density-dot";
      dotsDiv.appendChild(dot);
    }
    cell.appendChild(dotsDiv);
  }

  cell.addEventListener("click", () => {
    onDateClick(dateKey);
  });

  return cell;
}
