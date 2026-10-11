import { MPNextWidget } from "../shared/base-widget";

/**
 * Local mirrors of `@mpnext/types` (`mission-trips.ts`). This package does not
 * import the workspace types package — same convention as every other widget.
 */
interface MyMissionTrip {
  pledgeId: number;
  pledgeCampaignId: number;
  campaignName: string;
  description: string | null;
  imageUrl: string | null;
  campaignGoal: number;
  totalPledge: number;
  raised: number;
  pledgeStatusId: number;
  pledgeStatus: string | null;
  tripLeader: boolean;
  /** False for a household member's trip that is not the caller's own. */
  isMine: boolean;
  firstName: string | null;
  lastName: string | null;
  startDate: string | null;
  endDate: string | null;
  eventStartDate: string | null;
  eventEndDate: string | null;
}

interface MissionDonorAddress {
  line1: string | null;
  line2: string | null;
  city: string | null;
  stateRegion: string | null;
  postalCode: string | null;
  foreignCountry: string | null;
}

interface MissionDonor {
  pledgeId: number;
  pledgeCampaignId: number;
  campaignName: string | null;
  donorName: string;
  anonymous: boolean;
  amount: number;
  currency: string | null;
  notes: string | null;
  donationDate: string | null;
  /** Whole-object null when `Home_Address_Unlisted` is set. */
  address: MissionDonorAddress | null;
  phone: string | null;
  email: string | null;
  imageUrl: string | null;
}

interface MissionTeamMember {
  pledgeId: number;
  pledgeCampaignId: number;
  campaignName: string | null;
  firstName: string | null;
  lastName: string | null;
  pledgeStatusId: number;
  pledgeStatus: string | null;
  campaignGoal: number;
  totalPledge: number;
  raised: number;
  tripLeader: boolean;
  email: string | null;
  phone: string | null;
  imageUrl: string | null;
}

/**
 * `next-my-mission-trips` (C76) — a participant's own trips, their donors and,
 * for a trip leader, the team roster.
 *
 * Replaces the legacy `mpp-my-mission-trips`, and fixes the one real security
 * defect in the domain along the way.
 *
 * **`show-donors` and `show-team-progress` are display hints, not gates.**
 * Legacy's `showteamprogress` attribute and its client-side
 * `tripLeader === true` array filter were the *only* protection on
 * `api_MPPW_GetMyMissionTripTeamProgress`, which has no `Trip_Leader` predicate
 * at all — any participant could read every teammate's email, mobile number
 * and fundraising position, on a youth trip a roster of minors' phone numbers.
 * The server now decides. These attributes decide only whether the widget
 * *asks*: with `show-team-progress` unset, no request to `/team` is made at all.
 * Both default to `false`, matching legacy's `=== "true"` comparison, so an
 * unset attribute never opts a church into displaying donor addresses.
 *
 * **`not_trip_leader` and `not_a_participant` hide their panel silently.** A
 * participant who is not the trip leader is in an ordinary state, not an error
 * state, and rendering "Only the trip leader can see the team's progress." to
 * every teammate would be noise on every card. The codes are protocol signals;
 * the catalogue sentences exist for anything that renders them anyway.
 */
export class MyMissionTripsWidget extends MPNextWidget {
  private trips: MyMissionTrip[] = [];
  /** Donors and roster by campaign id — absent means "not shown". */
  private donorsByCampaign = new Map<number, MissionDonor[]>();
  private teamByCampaign = new Map<number, MissionTeamMember[]>();

  private loading = true;
  private error: string | null = null;
  private signedOut = false;

  static get observedAttributes() {
    return ["api-host", "campaign-type-id", "show-donors", "show-team-progress"];
  }

  attributeChangedCallback(_name: string, oldValue: string | null, newValue: string | null) {
    if (oldValue === newValue) return;
    if (this.trips.length || !this.loading) void this.load();
  }

  connectedCallback() {
    this.injectStyles(this.getStyles());
    // Await the catalogue before the first paint so a Spanish visitor never
    // sees English swap to Spanish.
    void this.initLocale().then(() => {
      this.render();
      void this.load();
    });
  }

  /** Public hook so demo pages can reload after sign-in. */
  public retryLoad() {
    this.error = null;
    void this.load();
  }

  // ── Attributes ──────────────────────────────────────────────────────────

  private get campaignTypeId(): string {
    return (this.getAttribute("campaign-type-id") || "").trim();
  }

  /** Opt-in, like legacy. An unset attribute must never show donor addresses. */
  private get showDonors(): boolean {
    return this.getAttribute("show-donors") === "true";
  }

  private get showTeamProgress(): boolean {
    return this.getAttribute("show-team-progress") === "true";
  }

  // ── Load ────────────────────────────────────────────────────────────────

  private async load() {
    this.loading = true;
    this.error = null;
    this.signedOut = false;
    this.donorsByCampaign = new Map();
    this.teamByCampaign = new Map();
    this.render();

    const query = this.campaignTypeId
      ? `?campaignTypeId=${encodeURIComponent(this.campaignTypeId)}`
      : "";

    try {
      const res = await this.fetch(`/api/embed/mission-trips/mine${query}`);
      if (this.isNeedsAuth(res)) {
        // Signed out is a state, not an error (C81 / CROSS-1): the widget
        // offers sign-in rather than "Unable to Load". A 401 that reaches a
        // signed-in visitor is not this state and falls through to the error.
        this.signedOut = true;
        this.trips = [];
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(this.errorText(body));
      }
      const data: { trips?: MyMissionTrip[] } = await res.json();
      this.trips = data.trips || [];
      this.emit("myMissionTripsLoaded", { count: this.trips.length });

      await this.loadPanels();
    } catch (err) {
      this.error = err instanceof Error ? err.message : this.t("errors.network");
      this.trips = [];
      this.emit("myMissionTripsError", { error: this.error });
    } finally {
      this.loading = false;
      this.render();
      this.attachListeners();
    }
  }

  /**
   * Fetch the optional panels, once per distinct campaign rather than once per
   * pledge — a household with two members on the same trip has two rows and one
   * donor list.
   */
  private async loadPanels() {
    if (!this.showDonors && !this.showTeamProgress) return;
    const campaignIds = [...new Set(this.trips.map((t) => t.pledgeCampaignId))];

    await Promise.all(
      campaignIds.flatMap((id) => [
        this.showDonors ? this.loadDonors(id) : null,
        this.showTeamProgress ? this.loadTeam(id) : null,
      ]).filter((p): p is Promise<void> => p !== null),
    );
  }

  private panelQuery(campaignId: number): string {
    const params = new URLSearchParams({ campaignId: String(campaignId) });
    if (this.campaignTypeId) params.set("campaignTypeId", this.campaignTypeId);
    return `?${params.toString()}`;
  }

  private async loadDonors(campaignId: number) {
    try {
      const res = await this.fetch(
        `/api/embed/mission-trips/donors${this.panelQuery(campaignId)}`,
      );
      if (!res.ok) {
        // `not_a_participant` — and any other refusal — leaves the panel
        // unrendered rather than painting an error into someone else's card.
        this.notePanelRefusal(res);
        return;
      }
      const data: { donors?: MissionDonor[] } = await res.json();
      this.donorsByCampaign.set(campaignId, data.donors || []);
    } catch {
      /* A panel that cannot load is simply absent. */
    }
  }

  private async loadTeam(campaignId: number) {
    try {
      const res = await this.fetch(
        `/api/embed/mission-trips/team${this.panelQuery(campaignId)}`,
      );
      if (!res.ok) {
        this.notePanelRefusal(res);
        return;
      }
      const data: { team?: MissionTeamMember[] } = await res.json();
      this.teamByCampaign.set(campaignId, data.team || []);
    } catch {
      /* As above. */
    }
  }

  /**
   * Log anything that is not one of the two expected refusals.
   *
   * `not_trip_leader` and `not_a_participant` are the ordinary answers for a
   * participant who is not the leader, or a household row whose campaign the
   * caller holds no pledge on — silence is correct and a console warning would
   * cry wolf on every load.
   */
  private notePanelRefusal(res: Response) {
    if (res.status === 403) return;
    console.warn(`[mpnext] mission-trip panel unavailable (${res.status})`);
  }

  // ── Listeners ───────────────────────────────────────────────────────────

  private attachListeners() {
    this.root
      .querySelector('[data-action="retry"]')
      ?.addEventListener("click", () => this.retryLoad());
    // The signed-out panel's Sign In button is bound by the base class.
  }

  // ── Render ──────────────────────────────────────────────────────────────

  render() {
    this.root.innerHTML = `
      <section class="mmt">
        <h2 class="mmt-title">${this.escapeHtml(this.t("myMissionTrips.title"))}</h2>
        ${this.renderBody()}
      </section>`;
  }

  private renderBody(): string {
    if (this.loading) {
      return `<div class="mmt-state">${this.spinnerSvg()}<span>${this.escapeHtml(this.t("myMissionTrips.loading"))}</span></div>`;
    }
    if (this.signedOut) {
      // Mode-aware: a Sign In button in `dual`/`hardened`, instructional copy
      // and no button in `legacy`. Never "Try Again".
      return this.renderSignInRequired({
        subject: "my-mission-trips",
        message: this.t("myMissionTrips.signInPrompt"),
        className: "mmt-state mmt-signin",
        buttonClass: "mmt-btn",
      });
    }
    if (this.error) {
      return `
        <div class="mmt-state mmt-error">
          <p class="mmt-error-title">${this.escapeHtml(this.t("common.unableToLoad"))}</p>
          <p>${this.escapeHtml(this.error)}</p>
          <button class="mmt-btn" type="button" data-action="retry">${this.escapeHtml(this.t("common.retry"))}</button>
        </div>`;
    }
    if (this.trips.length === 0) {
      return `<div class="mmt-state mmt-empty">${this.escapeHtml(this.t("myMissionTrips.empty"))}</div>`;
    }

    const mine = this.trips.filter((t) => t.isMine);
    const family = this.trips.filter((t) => !t.isMine);

    // Legacy's "Family Mission Trips" section: rows a head of household sees
    // for a household member rather than for themselves.
    const familySection = family.length
      ? `
        <h3 class="mmt-section">${this.escapeHtml(this.t("myMissionTrips.familyTitle"))}</h3>
        <div class="mmt-list">${family.map((t) => this.renderTrip(t)).join("")}</div>`
      : "";

    return `
      <div class="mmt-list">${mine.map((t) => this.renderTrip(t)).join("")}</div>
      ${familySection}`;
  }

  private renderTrip(trip: MyMissionTrip): string {
    const media = trip.imageUrl
      ? `<img class="mmt-image" src="${this.escapeAttr(trip.imageUrl)}" alt="" loading="lazy">`
      : `<div class="mmt-image mmt-image--placeholder">${this.globeSvg()}</div>`;

    const owner = [trip.firstName, trip.lastName]
      .filter((p): p is string => !!p && p.trim().length > 0)
      .join(" ");
    const ownerHtml = owner ? `<p class="mmt-owner">${this.escapeHtml(owner)}</p>` : "";

    const leaderBadge = trip.tripLeader
      ? `<span class="mmt-badge mmt-badge--leader">${this.escapeHtml(this.t("myMissionTrips.leader"))}</span>`
      : "";
    const statusBadge = trip.pledgeStatus
      ? `<span class="mmt-badge ${this.statusClass(trip.pledgeStatus)}">${this.escapeHtml(this.statusLabel(trip.pledgeStatus))}</span>`
      : "";

    const dates = this.tripDates(trip);
    const datesHtml = dates ? `<p class="mmt-dates">${this.escapeHtml(dates)}</p>` : "";

    const goal = trip.totalPledge > 0 ? trip.totalPledge : trip.campaignGoal;
    const pct = this.percent(trip.raised, goal);
    const progressText = this.t("myPledges.progress", {
      paid: this.fmt.currency(trip.raised),
      total: this.fmt.currency(goal),
      percent: this.fmt.percent(pct),
    });

    return `
      <article class="mmt-card">
        <div class="mmt-card-top">
          ${media}
          <div class="mmt-card-head">
            <div class="mmt-badges">${leaderBadge}${statusBadge}</div>
            <h4 class="mmt-name">${this.escapeHtml(trip.campaignName)}</h4>
            ${ownerHtml}
            ${datesHtml}
          </div>
        </div>
        <div class="mmt-progress">
          <p class="mmt-progress-label">${this.escapeHtml(this.t("myMissionTrips.supportProgress"))}</p>
          <div class="mmt-track"><div class="mmt-fill" style="width:${pct}%"></div></div>
          <p class="mmt-progress-text">${this.escapeHtml(progressText)}</p>
        </div>
        ${this.renderDonors(trip)}
        ${this.renderTeam(trip)}
      </article>`;
  }

  // ── Donor panel ─────────────────────────────────────────────────────────

  private renderDonors(trip: MyMissionTrip): string {
    if (!this.showDonors) return "";
    const donors = this.donorsByCampaign.get(trip.pledgeCampaignId);
    // Absent (rather than empty) means the server declined — silently.
    if (!donors) return "";

    const forPledge = donors.filter((d) => d.pledgeId === trip.pledgeId);
    const body = forPledge.length
      ? `<div class="mmt-rows">${forPledge.map((d) => this.renderDonor(d)).join("")}</div>`
      : `<p class="mmt-panel-empty">${this.escapeHtml(this.t("myMissionTrips.donorsEmpty"))}</p>`;

    return `
      <section class="mmt-panel">
        <h5 class="mmt-panel-title">${this.escapeHtml(this.t("myMissionTrips.donorsTitle"))}</h5>
        ${body}
      </section>`;
  }

  private renderDonor(donor: MissionDonor): string {
    // An anonymous donation carries no contact data at all, and the label is
    // ours rather than the server's so it is translated.
    const name = donor.anonymous
      ? this.t("myMissionTrips.anonymousDonor")
      : donor.donorName;

    const address = donor.anonymous ? null : this.formatAddress(donor.address);
    // A suppressed field is `null`, and a null field renders nothing at all —
    // no label, no empty block. `Home_Address_Unlisted` suppresses the address
    // as a unit, which is why the whole object is nullable on the wire.
    const addressHtml = address
      ? `<p class="mmt-donor-line">${this.escapeHtml(address)}</p>`
      : "";
    const phoneHtml = !donor.anonymous && donor.phone
      ? `<p class="mmt-donor-line">${this.escapeHtml(donor.phone)}</p>`
      : "";
    const emailHtml = !donor.anonymous && donor.email
      ? `<p class="mmt-donor-line">${this.escapeHtml(donor.email)}</p>`
      : "";
    const notesHtml = donor.notes
      ? `<p class="mmt-donor-note">${this.escapeHtml(donor.notes)}</p>`
      : "";
    const dateHtml = donor.donationDate
      ? `<span class="mmt-donor-date">${this.escapeHtml(this.fmt.date(donor.donationDate, "medium"))}</span>`
      : "";

    return `
      <div class="mmt-row">
        <div class="mmt-row-main">
          <p class="mmt-donor-name">${this.escapeHtml(name)}</p>
          ${addressHtml}
          ${phoneHtml}
          ${emailHtml}
          ${notesHtml}
        </div>
        <div class="mmt-row-side">
          <span class="mmt-amount">${this.escapeHtml(this.fmt.currency(donor.amount, donor.currency))}</span>
          ${dateHtml}
        </div>
      </div>`;
  }

  /** One line, skipping every suppressed or empty part. */
  private formatAddress(address: MissionDonorAddress | null): string {
    if (!address) return "";
    const cityLine = [
      address.city,
      [address.stateRegion, address.postalCode].filter(Boolean).join(" ").trim(),
    ]
      .filter((p) => !!p && p.trim().length > 0)
      .join(", ");
    return [address.line1, address.line2, cityLine, address.foreignCountry]
      .filter((p): p is string => !!p && p.trim().length > 0)
      .join(", ");
  }

  // ── Team panel ──────────────────────────────────────────────────────────

  private renderTeam(trip: MyMissionTrip): string {
    if (!this.showTeamProgress) return "";
    const team = this.teamByCampaign.get(trip.pledgeCampaignId);
    // `not_trip_leader` never reached the map, so the panel is simply absent.
    if (!team) return "";

    const body = team.length
      ? `<div class="mmt-rows">${team.map((m) => this.renderTeamMember(m)).join("")}</div>`
      : `<p class="mmt-panel-empty">${this.escapeHtml(this.t("myMissionTrips.teamEmpty"))}</p>`;

    return `
      <section class="mmt-panel">
        <h5 class="mmt-panel-title">${this.escapeHtml(this.t("myMissionTrips.teamTitle"))}</h5>
        ${body}
      </section>`;
  }

  private renderTeamMember(member: MissionTeamMember): string {
    const name = [member.firstName, member.lastName]
      .filter((p): p is string => !!p && p.trim().length > 0)
      .join(" ");
    const goal = member.totalPledge > 0 ? member.totalPledge : member.campaignGoal;
    const pct = this.percent(member.raised, goal);

    // `email` / `phone` are null when the teammate's unlisted flags are set —
    // the donors procedure honoured those and the roster procedure did not.
    const emailHtml = member.email
      ? `<p class="mmt-donor-line">${this.escapeHtml(member.email)}</p>`
      : "";
    const phoneHtml = member.phone
      ? `<p class="mmt-donor-line">${this.escapeHtml(member.phone)}</p>`
      : "";
    const statusHtml = member.pledgeStatus
      ? `<p class="mmt-team-status"><span class="mmt-team-label">${this.escapeHtml(this.t("myMissionTrips.pledgeStatus"))}</span> ${this.escapeHtml(this.statusLabel(member.pledgeStatus))}</p>`
      : "";
    const leaderBadge = member.tripLeader
      ? `<span class="mmt-badge mmt-badge--leader">${this.escapeHtml(this.t("myMissionTrips.leader"))}</span>`
      : "";

    return `
      <div class="mmt-row">
        <div class="mmt-row-main">
          <p class="mmt-donor-name">${this.escapeHtml(name)}${leaderBadge}</p>
          ${emailHtml}
          ${phoneHtml}
          ${statusHtml}
        </div>
        <div class="mmt-row-side">
          <span class="mmt-team-goal"><span class="mmt-team-label">${this.escapeHtml(this.t("myMissionTrips.supportGoal"))}</span> ${this.escapeHtml(this.fmt.currency(goal))}</span>
          <span class="mmt-team-goal"><span class="mmt-team-label">${this.escapeHtml(this.t("myMissionTrips.amountRaised"))}</span> ${this.escapeHtml(this.fmt.currency(member.raised))}</span>
          <div class="mmt-track mmt-track--sm"><div class="mmt-fill" style="width:${pct}%"></div></div>
          <span class="mmt-team-pct">${this.escapeHtml(this.fmt.percent(pct))}</span>
        </div>
      </div>`;
  }

  // ── Shared bits ─────────────────────────────────────────────────────────

  /** The trip's own dates, with the year (`C09`). */
  private tripDates(trip: MyMissionTrip): string {
    const start = trip.eventStartDate || trip.startDate;
    if (!start) return "";
    const end = trip.eventEndDate || trip.endDate;
    const range = end
      ? this.fmt.dateRangeCompact(start, end, "medium")
      : this.fmt.date(start, "medium");
    if (!range) return "";
    return this.t("myMissionTrips.tripDates", { dates: range });
  }

  private percent(raised: number, goal: number): number {
    if (!(goal > 0) || raised <= 0) return 0;
    if (raised >= goal) return 100;
    return Math.trunc((raised / goal) * 100);
  }

  /**
   * MP's four shipped pledge statuses, translated through the keys
   * `next-my-pledges` already owns. A domain that added its own status falls
   * through to MP's value — the church's own wording, better than a key name.
   */
  private statusLabel(status: string): string {
    switch (status) {
      case "Active":
        return this.t("myPledges.status.active");
      case "Completed":
        return this.t("myPledges.status.completed");
      case "Discontinued":
        return this.t("myPledges.status.discontinued");
      case "Pending":
        return this.t("myPledges.status.pending");
      default:
        return status;
    }
  }

  private statusClass(status: string): string {
    switch (status) {
      case "Active":
        return "mmt-badge--active";
      case "Completed":
        return "mmt-badge--completed";
      case "Discontinued":
        return "mmt-badge--discontinued";
      case "Pending":
        return "mmt-badge--pending";
      default:
        return "mmt-badge--default";
    }
  }

  private escapeHtml(text: string): string {
    const el = document.createElement("span");
    el.textContent = text;
    return el.innerHTML;
  }

  private escapeAttr(text: string): string {
    return this.escapeHtml(text).replace(/"/g, "&quot;");
  }

  private spinnerSvg(): string {
    return `<svg class="mmt-spinner" viewBox="0 0 24 24" fill="none" width="20" height="20">
      <circle opacity="0.25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
      <path opacity="0.75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
    </svg>`;
  }

  private globeSvg(): string {
    return `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#004C97" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`;
  }

  private getStyles(): string {
    return `
      :host { all: initial; display: block; font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; color: #2D2926; }
      .mmt { max-width: 860px; margin: 0 auto; }
      .mmt-title { font-size: 22px; font-weight: 700; color: #002855; margin: 0 0 16px; }
      .mmt-section { font-size: 16px; font-weight: 700; color: #002855; margin: 24px 0 12px; }

      .mmt-list { display: flex; flex-direction: column; gap: 16px; }
      .mmt-card { border: 1px solid #e5e7eb; border-radius: 12px; padding: 16px; background: white; }
      .mmt-card-top { display: flex; align-items: flex-start; gap: 14px; }
      .mmt-image { width: 64px; height: 64px; border-radius: 10px; object-fit: cover; flex-shrink: 0; background: #f3f4f6; }
      .mmt-image--placeholder { display: flex; align-items: center; justify-content: center; background: rgba(0,76,151,0.08); }
      .mmt-card-head { flex: 1; min-width: 0; }
      .mmt-badges { display: flex; gap: 6px; flex-wrap: wrap; }
      .mmt-name { font-size: 16px; font-weight: 700; color: #002855; margin: 6px 0 0; line-height: 1.3; }
      .mmt-owner { font-size: 13px; color: rgba(45,41,38,0.6); margin: 2px 0 0; }
      .mmt-dates { font-size: 13px; color: #004C97; font-weight: 600; margin: 4px 0 0; }

      .mmt-badge { display: inline-flex; align-items: center; padding: 3px 10px; border-radius: 9999px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.03em; white-space: nowrap; }
      .mmt-badge--leader { background: rgba(241,190,72,0.25); color: #92700c; margin-left: 8px; }
      .mmt-badge--active { background: rgba(134,173,63,0.15); color: #5a7a1a; }
      .mmt-badge--completed { background: rgba(0,76,151,0.12); color: #004C97; }
      .mmt-badge--discontinued { background: rgba(255,109,106,0.15); color: #b91c1c; }
      .mmt-badge--pending { background: rgba(241,190,72,0.2); color: #92700c; }
      .mmt-badge--default { background: #f3f4f6; color: #474747; }

      .mmt-progress { margin-top: 16px; }
      .mmt-progress-label { font-size: 12px; font-weight: 600; color: #6b7280; margin: 0 0 6px; text-transform: uppercase; letter-spacing: 0.03em; }
      .mmt-track { width: 100%; height: 12px; background: #f3f4f6; border-radius: 9999px; overflow: hidden; }
      .mmt-track--sm { height: 8px; margin-top: 4px; }
      .mmt-fill { height: 100%; background: #004C97; border-radius: 9999px; }
      .mmt-progress-text { margin: 6px 0 0; font-size: 13px; font-weight: 600; color: #002855; }

      .mmt-panel { margin-top: 16px; padding-top: 14px; border-top: 1px solid #f3f4f6; }
      .mmt-panel-title { font-size: 13px; font-weight: 700; color: #002855; margin: 0 0 10px; text-transform: uppercase; letter-spacing: 0.03em; }
      .mmt-panel-empty { font-size: 13px; color: #6b7280; margin: 0; }
      .mmt-rows { display: flex; flex-direction: column; gap: 10px; }
      .mmt-row { display: flex; justify-content: space-between; gap: 12px; padding: 10px; background: #fafafa; border-radius: 8px; }
      .mmt-row-main { min-width: 0; }
      .mmt-row-side { text-align: right; display: flex; flex-direction: column; gap: 2px; align-items: flex-end; min-width: 140px; }
      .mmt-donor-name { font-size: 14px; font-weight: 600; color: #2D2926; margin: 0; }
      .mmt-donor-line { font-size: 12px; color: #6b7280; margin: 2px 0 0; }
      .mmt-donor-note { font-size: 12px; color: #474747; margin: 4px 0 0; font-style: italic; }
      .mmt-donor-date { font-size: 12px; color: #6b7280; }
      .mmt-amount { font-size: 14px; font-weight: 700; color: #004C97; }
      .mmt-team-label { font-size: 11px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.03em; }
      .mmt-team-goal { font-size: 13px; color: #2D2926; }
      .mmt-team-status { font-size: 12px; color: #474747; margin: 4px 0 0; }
      .mmt-team-pct { font-size: 12px; font-weight: 600; color: #002855; }

      .mmt-state { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 40px 16px; color: #6b7280; font-size: 15px; text-align: center; }
      .mmt-state p { margin: 0; }
      .mmt-error-title { font-weight: 700; color: #002855; }
      .mmt-error p { color: #b91c1c; }
      .mmt-spinner { animation: mmt-spin 1s linear infinite; color: #004C97; }
      @keyframes mmt-spin { to { transform: rotate(360deg); } }
      .mmt-btn { padding: 10px 24px; background: #004C97; color: white; border: none; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; font-family: inherit; }
      .mmt-btn:hover { background: #002855; }

      @media (max-width: 640px) {
        .mmt-row { flex-direction: column; }
        .mmt-row-side { text-align: left; align-items: flex-start; }
      }
    `;
  }
}

customElements.define("next-my-mission-trips", MyMissionTripsWidget);
