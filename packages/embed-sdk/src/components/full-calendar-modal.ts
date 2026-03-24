// ── Types (local, not imported) ──

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

interface RenderDetailModalOptions {
  event: CalendarEvent;
  fcEvent?: { start: Date | null; end: Date | null };
  isAdmin: boolean;
  onClose: () => void;
  getEventColor: (typeId: number | null) => string;
}

// ── SVG Icons ──

const ICON_CALENDAR = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`;

const ICON_PIN = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`;

const ICON_EXTERNAL = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`;

const ICON_CALENDAR_PLACEHOLDER = `<svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`;

// ── Helper Functions (module-private) ──

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function sanitizeHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const allowed = new Set(["P", "A", "BR", "B", "STRONG", "I", "EM", "UL", "OL", "LI"]);

  const clean = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return escapeHtml(node.textContent || "");
    if (node.nodeType !== Node.ELEMENT_NODE) return "";

    const el = node as Element;
    const tag = el.tagName;

    if (!allowed.has(tag)) {
      return Array.from(el.childNodes).map(clean).join("");
    }

    const lowerTag = tag.toLowerCase();
    let attrs = "";
    if (tag === "A") {
      const href = el.getAttribute("href");
      if (href && (href.startsWith("http://") || href.startsWith("https://"))) {
        attrs = ` href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer"`;
      }
    }

    const inner = Array.from(el.childNodes).map(clean).join("");
    if (tag === "BR") return "<br>";
    return `<${lowerTag}${attrs}>${inner}</${lowerTag}>`;
  };

  return Array.from(doc.body.childNodes).map(clean).join("");
}

function formatDateTime(date: Date): string {
  return date.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

// ── Exported Render Function ──

export function renderDetailModal(options: RenderDetailModalOptions): HTMLElement {
  const { event, fcEvent, isAdmin, onClose, getEventColor } = options;

  // Resolve start/end dates: prefer fcEvent dates, fall back to parsing event strings
  const startDate = fcEvent?.start ?? new Date(event.Event_Start_Date);
  const endDate = fcEvent?.end ?? new Date(event.Event_End_Date);

  const startStr = formatDateTime(startDate);
  const endStr = formatDateTime(endDate);
  const dateRange = endStr && endStr !== startStr ? `${startStr} \u2013 ${endStr}` : startStr;

  const typeColor = getEventColor(event.Event_Type_ID);

  const overlay = document.createElement("div");
  overlay.className = "nw-fc-modal-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", event.Event_Title);

  // ── Build image header ──
  let imageHtml = "";
  if (event.Image_URL) {
    imageHtml = `<img class="nw-fc-modal-image" src="${escapeHtml(event.Image_URL)}" alt="${escapeHtml(event.Event_Title)}">`;
  } else {
    imageHtml = `<div class="nw-fc-modal-image-placeholder">${ICON_CALENDAR_PLACEHOLDER}</div>`;
  }

  // ── Build badges ──
  let badgesHtml = "";
  if (event.Event_Type) {
    badgesHtml += `<span class="nw-fc-badge nw-fc-badge-type" style="background:${typeColor};">${escapeHtml(event.Event_Type)}</span>`;
  }
  if (event.Congregation_Name) {
    badgesHtml += `<span class="nw-fc-badge nw-fc-badge-campus">${escapeHtml(event.Congregation_Name)}</span>`;
  }
  if (event.Featured_On_Calendar) {
    badgesHtml += `<span class="nw-fc-badge nw-fc-badge-featured">Featured</span>`;
  }

  // ── Build body rows ──
  let bodyHtml = "";

  // Date/time row
  if (dateRange) {
    bodyHtml += `
      <div class="nw-fc-modal-meta-row">
        <span class="nw-fc-modal-meta-icon" aria-hidden="true">${ICON_CALENDAR}</span>
        <span class="nw-fc-modal-meta-text">${escapeHtml(dateRange)}</span>
      </div>`;
  }

  // Location row
  if (event.Location_Name) {
    bodyHtml += `
      <div class="nw-fc-modal-meta-row">
        <span class="nw-fc-modal-meta-icon" aria-hidden="true">${ICON_PIN}</span>
        <span class="nw-fc-modal-meta-text">${escapeHtml(event.Location_Name)}</span>
      </div>`;
  }

  // Description
  if (event.Description) {
    bodyHtml += `
      <div class="nw-fc-modal-description">
        ${sanitizeHtml(event.Description)}
      </div>`;
  }

  // Register button
  if (event.Registration_URL) {
    bodyHtml += `
      <div class="nw-fc-modal-actions">
        <a class="nw-fc-register-btn" href="${escapeHtml(event.Registration_URL)}" target="_blank" rel="noopener noreferrer">Register</a>
      </div>`;
  }

  // ── Build admin section ──
  let adminHtml = "";
  if (isAdmin) {
    const participantCount = event.Participant_Count != null ? String(event.Participant_Count) : "\u2014";
    const participantsExpected = event.Participants_Expected != null ? String(event.Participants_Expected) : "\u2014";
    const registrationProduct = event.Registration_Product_Name || "\u2014";
    const ministry = event.Ministry_Name || "\u2014";

    let contactHtml = "\u2014";
    if (event.Primary_Contact_Name) {
      contactHtml = escapeHtml(event.Primary_Contact_Name);
      if (event.Primary_Contact_Email) {
        contactHtml += ` &middot; <a href="mailto:${escapeHtml(event.Primary_Contact_Email)}">${escapeHtml(event.Primary_Contact_Email)}</a>`;
      }
      if (event.Primary_Contact_Phone) {
        contactHtml += ` &middot; ${escapeHtml(event.Primary_Contact_Phone)}`;
      }
    }

    let mpLinkHtml = "";
    if (event.MP_Detail_URL) {
      mpLinkHtml = `
        <a class="nw-fc-mp-link" href="${escapeHtml(event.MP_Detail_URL)}" target="_blank" rel="noopener noreferrer">
          Open in Ministry Platform ${ICON_EXTERNAL}
        </a>`;
    }

    adminHtml = `
      <div class="nw-fc-admin-section">
        <div class="nw-fc-admin-divider">Admin Details</div>
        <div class="nw-fc-admin-row">
          <span class="nw-fc-admin-label">Participants</span>
          <span class="nw-fc-admin-value">${participantCount} / ${participantsExpected}</span>
        </div>
        <div class="nw-fc-admin-row">
          <span class="nw-fc-admin-label">Registration</span>
          <span class="nw-fc-admin-value">${escapeHtml(registrationProduct)}</span>
        </div>
        <div class="nw-fc-admin-row">
          <span class="nw-fc-admin-label">Ministry</span>
          <span class="nw-fc-admin-value">${escapeHtml(ministry)}</span>
        </div>
        <div class="nw-fc-admin-row">
          <span class="nw-fc-admin-label">Contact</span>
          <span class="nw-fc-admin-value">${contactHtml}</span>
        </div>
        ${mpLinkHtml}
      </div>`;
  }

  // ── Assemble modal ──
  overlay.innerHTML = `
    <div class="nw-fc-modal">
      ${imageHtml}
      <div class="nw-fc-modal-header" style="border-left: 4px solid ${typeColor};">
        <div class="nw-fc-modal-title-row">
          <h2 class="nw-fc-modal-title">${escapeHtml(event.Event_Title)}</h2>
          <button class="nw-fc-modal-close" aria-label="Close">&times;</button>
        </div>
        <div class="nw-fc-modal-badges">
          ${badgesHtml}
        </div>
      </div>
      <div class="nw-fc-modal-body">
        ${bodyHtml}
      </div>
      ${adminHtml}
    </div>
  `;

  // ── Event Handlers ──

  // Close on overlay click (outside modal)
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) onClose();
  });

  // Close button
  const closeBtn = overlay.querySelector<HTMLButtonElement>(".nw-fc-modal-close");
  closeBtn?.addEventListener("click", () => onClose());

  // Close on Escape key
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      onClose();
      document.removeEventListener("keydown", onKeyDown);
    }
  };
  document.addEventListener("keydown", onKeyDown);

  // Trigger entrance animation after appending
  requestAnimationFrame(() => overlay.classList.add("nw-fc-modal-visible"));

  return overlay;
}
