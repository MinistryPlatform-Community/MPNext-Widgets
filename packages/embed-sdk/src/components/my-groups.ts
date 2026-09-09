import { MPNextWidget } from "../shared/base-widget";
import { parseWallClock } from "../i18n";

interface GroupAddress {
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  stateRegion: string | null;
  postalCode: string | null;
}

interface Group {
  groupId: number;
  groupName: string;
  description: string | null;
  startDate: string | null;
  endDate: string | null;
  availableOnline: boolean;
  meetingDay: string | null;
  meetingTime: string | null;
  meetsOnline: boolean;
  isUserLeader: boolean;
  volunteerGroup: boolean;
  groupRoleId: number | null;
  congregationId: number | null;
  primaryContactId: number | null;
  imageUrl: string | null;
  location: GroupAddress | null;
}

export class MyGroupsWidget extends MPNextWidget {
  private groups: Group[] = [];
  private cloudUrlPrefix: string | null = null;
  private loading = true;
  private error: string | null = null;

  static get observedAttributes() {
    return ["hidegrouplife"];
  }

  private get hideGroupLife(): boolean {
    return (this.getAttribute("hidegrouplife") || "false").toLowerCase() === "true";
  }

  connectedCallback() {
    this.injectStyles(this.getStyles());
    // Await the catalogue before the first paint so a Spanish visitor never
    // sees English swap to Spanish; the fetch hides inside the loading state
    // this widget already paints while it queries the API.
    void this.initLocale().then(() => {
      this.render();
      this.loadGroups();
    });
  }

  attributeChangedCallback(_name: string, oldValue: string | null, newValue: string | null) {
    if (oldValue !== null && oldValue !== newValue) {
      this.loadGroups();
    }
  }

  public retryLoad() {
    this.error = null;
    this.loadGroups();
  }

  private async loadGroups() {
    this.loading = true;
    this.error = null;
    this.render();

    try {
      const res = await this.fetch("/api/embed/my-groups");
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(this.errorText(data));
      }
      const data: { groups: Group[]; cloudUrlPrefix: string | null } = await res.json();
      this.groups = data.groups || [];
      this.cloudUrlPrefix = data.cloudUrlPrefix || null;
      this.emit("groupsLoaded", { count: this.groups.length });
    } catch (err) {
      // `errorText` has already produced a translated sentence; a thrown
      // non-Error (a dropped connection) becomes the generic network message
      // rather than leaking English.
      this.error = err instanceof Error ? err.message : this.t("errors.network");
      this.emit("groupError", { error: this.error });
    } finally {
      this.loading = false;
      this.render();
      this.attachListeners();
    }
  }

  private attachListeners() {
    const retryBtn = this.root.querySelector('[data-action="retry"]');
    if (retryBtn) {
      retryBtn.addEventListener("click", () => this.retryLoad());
    }
  }

  render() {
    if (this.loading) {
      this.root.innerHTML = `
        <div class="nw-groups">
          <div class="header">
            <div class="loading-row">
              ${this.spinnerSvg()}
              <span>${this.escapeHtml(this.t("myGroups.loading"))}</span>
            </div>
          </div>
        </div>`;
      return;
    }

    if (this.error) {
      this.root.innerHTML = `
        <div class="nw-groups">
          <div class="header">
            <div class="title">${this.escapeHtml(this.t("common.unableToLoad"))}</div>
            <p class="subtitle">${this.escapeHtml(this.error)}</p>
          </div>
          <div class="retry-section">
            <button class="retry-btn" data-action="retry">${this.escapeHtml(this.t("common.retry"))}</button>
          </div>
        </div>`;
      return;
    }

    this.root.innerHTML = this.renderMain();
  }

  private renderMain(): string {
    const body =
      this.groups.length === 0
        ? `<div class="empty-state">${this.escapeHtml(this.t("myGroups.empty"))}</div>`
        : `<div class="group-grid">${this.groups.map((g) => this.renderGroupCard(g)).join("")}</div>`;

    return `
      <div class="nw-groups">
        <div class="header">
          <div class="title">${this.escapeHtml(this.t("myGroups.title"))}</div>
        </div>
        <div class="body">
          ${body}
        </div>
      </div>`;
  }

  private renderGroupCard(g: Group): string {
    const media = g.imageUrl
      ? `<img class="group-image" src="${this.escapeHtml(g.imageUrl)}" alt="${this.escapeHtml(g.groupName)}">`
      : `<div class="group-image group-image--placeholder">${this.groupSvg()}</div>`;

    let badge = "";
    if (g.isUserLeader && g.meetsOnline) {
      badge = `<span class="badge badge-leader">${this.escapeHtml(this.t("myGroups.leaderAndOnline"))}</span>`;
    } else if (g.isUserLeader) {
      badge = `<span class="badge badge-leader">${this.escapeHtml(this.t("myGroups.leader"))}</span>`;
    } else if (g.meetsOnline) {
      badge = `<span class="badge badge-online">${this.escapeHtml(this.t("myGroups.meetsOnline"))}</span>`;
    }

    const subtitles = this.buildSubtitles(g);
    const subtitleHtml = subtitles
      .map((s) => `<div class="group-subtitle">${this.escapeHtml(s)}</div>`)
      .join("");

    const description = g.description
      ? `<div class="group-desc">${this.escapeHtml(g.description)}</div>`
      : "";

    let groupLifeBtn = "";
    if (this.hideGroupLife === false && this.cloudUrlPrefix) {
      const segment = g.volunteerGroup ? "volunteer" : "group";
      const label = this.t(
        g.volunteerGroup ? "myGroups.volunteerConnect" : "myGroups.groupConnect"
      );
      const url = `https://${this.cloudUrlPrefix}.cloudapps.ministryplatform.cloud/connect/${segment}/${g.groupId}`;
      groupLifeBtn = `
        <div class="grouplife-area">
          <a class="grouplife-btn" target="_blank" rel="noopener" href="${this.escapeHtml(url)}">${this.escapeHtml(label)}</a>
        </div>`;
    }

    return `
      <div class="group-card">
        <div class="group-card-top">
          ${media}
          <div class="group-card-head">
            ${badge}
            <div class="group-name">${this.escapeHtml(g.groupName)}</div>
            ${subtitleHtml}
          </div>
        </div>
        ${description}
        ${groupLifeBtn}
      </div>`;
  }

  private buildSubtitles(g: Group): string[] {
    const lines: string[] = [];

    if (g.location) {
      const loc = g.location;
      const locationStr = `${loc.addressLine1 ?? ""}${loc.addressLine2 ? " " + loc.addressLine2 : ""}${loc.city ? ", " + loc.city : ""}${loc.stateRegion ? ", " + loc.stateRegion : ""}${loc.postalCode ? ", " + loc.postalCode : ""}`;
      if (locationStr.trim().length > 0) {
        lines.push(locationStr.trim());
      }
    }

    // The day name itself is MP-authored; only the join between day and time
    // is ours, and it differs by language ("@" / "a las" / "às").
    if (g.meetingDay) {
      lines.push(
        g.meetingTime
          ? this.t("myGroups.dayAtTime", {
              day: g.meetingDay,
              time: this.formatTime(g.meetingTime),
            })
          : g.meetingDay
      );
    }

    if (g.startDate) {
      if (this.isPast(g.startDate)) {
        lines.push(this.t("myGroups.alreadyMeeting"));
      } else {
        lines.push(
          this.t("myGroups.startsOn", {
            date: this.fmt.date(g.startDate, "medium"),
          })
        );
      }
    }

    return lines;
  }

  /**
   * Is this MP date strictly before today?
   *
   * `parseWallClock` replaces the local `parseDateParts` and keeps its whole
   * point: read the calendar parts and build a *local* Date, so the timezone
   * day-shift `new Date(isoString)` introduces on a trailing-Z string never
   * happens. The comparison is date-only, hence today's midnight.
   */
  private isPast(dateString: string): boolean {
    const date = parseWallClock(dateString);
    if (!date) return false;
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate(),
    ).getTime() < today.getTime();
  }

  /**
   * Format an MP time-of-day string ("18:30" or "1900-01-01T18:30:00").
   * Kept local rather than routed through `parseWallClock`, which needs a date
   * part; the hours/minutes go onto an arbitrary date so `fmt.time` can render
   * them in the visitor's locale.
   */
  private formatTime(timeString: string): string {
    if (!timeString) return "";
    const match = timeString.match(/(\d{1,2}):(\d{2})/);
    if (match) {
      const date = new Date(
        2000,
        0,
        1,
        parseInt(match[1], 10),
        parseInt(match[2], 10),
      );
      if (!isNaN(date.getTime())) return this.fmt.time(date);
    }
    return timeString.trim();
  }

  private escapeHtml(text: string): string {
    const el = document.createElement("span");
    el.textContent = text;
    return el.innerHTML;
  }

  private groupSvg(): string {
    return `<svg viewBox="0 0 24 24" fill="#004C97" class="group-icon" role="img" aria-label="${this.escapeHtml(this.t("myGroups.imageLabel"))}">
      <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/>
    </svg>`;
  }

  private spinnerSvg(): string {
    return `<svg class="spinner" viewBox="0 0 24 24" fill="none">
      <circle opacity="0.25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
      <path opacity="0.75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
    </svg>`;
  }

  private getStyles(): string {
    return `
      :host {
        all: initial;
        display: block;
        font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
      }

      .nw-groups {
        max-width: 800px;
        margin: 0 auto;
        background: white;
        border-radius: 16px;
        overflow: hidden;
        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
      }

      .header {
        background: #002855;
        color: white;
        padding: 24px;
      }
      .title {
        font-size: 24px;
        font-weight: bold;
        text-align: center;
        margin-bottom: 4px;
      }
      .subtitle {
        text-align: center;
        opacity: 0.8;
        font-size: 14px;
        margin: 0;
      }
      .loading-row {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 12px;
        font-size: 18px;
      }

      .spinner {
        width: 20px;
        height: 20px;
        animation: spin 1s linear infinite;
      }
      @keyframes spin {
        to { transform: rotate(360deg); }
      }

      .body {
        padding: 20px;
      }

      .empty-state {
        text-align: center;
        padding: 40px 20px;
        color: #9E9E9E;
        font-size: 14px;
      }

      .group-grid {
        display: flex;
        flex-direction: column;
        gap: 16px;
      }

      .group-card {
        border: 1px solid #e5e7eb;
        border-radius: 12px;
        padding: 16px;
        background: white;
      }
      .group-card-top {
        display: flex;
        align-items: flex-start;
        gap: 14px;
      }
      .group-image {
        width: 64px;
        height: 64px;
        border-radius: 10px;
        object-fit: cover;
        flex-shrink: 0;
        background: #f3f4f6;
      }
      .group-image--placeholder {
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(0, 76, 151, 0.08);
      }
      .group-icon {
        width: 32px;
        height: 32px;
      }
      .group-card-head {
        flex: 1;
        min-width: 0;
      }
      .group-name {
        font-size: 16px;
        font-weight: 700;
        color: #002855;
        margin-top: 6px;
        line-height: 1.3;
      }
      .group-subtitle {
        font-size: 13px;
        color: rgba(45, 41, 38, 0.7);
        margin-top: 2px;
      }

      .badge {
        display: inline-flex;
        align-items: center;
        padding: 3px 10px;
        border-radius: 9999px;
        font-size: 11px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.03em;
        white-space: nowrap;
      }
      .badge-leader {
        background: rgba(241, 190, 72, 0.2);
        color: #92700c;
      }
      .badge-online {
        background: rgba(0, 156, 222, 0.15);
        color: #006b99;
      }

      .group-desc {
        margin-top: 12px;
        font-size: 13px;
        color: rgba(45, 41, 38, 0.7);
        line-height: 1.5;
      }

      .grouplife-area {
        margin-top: 16px;
        padding-top: 14px;
        border-top: 1px solid #f3f4f6;
      }
      .grouplife-btn {
        display: inline-block;
        padding: 10px 24px;
        background: #004C97;
        color: white;
        font-weight: 600;
        font-size: 14px;
        border: none;
        border-radius: 8px;
        cursor: pointer;
        font-family: inherit;
        text-decoration: none;
        transition: background 0.15s;
      }
      .grouplife-btn:hover {
        background: #002855;
      }

      .retry-section {
        padding: 20px;
        text-align: center;
      }
      .retry-btn {
        display: inline-block;
        padding: 10px 24px;
        background: #004C97;
        color: white;
        font-weight: 600;
        font-size: 14px;
        border: none;
        border-radius: 8px;
        cursor: pointer;
        font-family: inherit;
        transition: background 0.15s;
      }
      .retry-btn:hover {
        background: #002855;
      }

      @media (max-width: 640px) {
        .header, .body {
          padding: 16px;
        }
        .group-card-top {
          gap: 12px;
        }
        .group-image {
          width: 52px;
          height: 52px;
        }
        .grouplife-btn {
          width: 100%;
          text-align: center;
        }
      }
    `;
  }
}

customElements.define("next-my-groups", MyGroupsWidget);
