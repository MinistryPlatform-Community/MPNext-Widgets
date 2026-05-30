import { MPNextWidget } from "../shared/base-widget";

interface UserMenuState {
  isDropdownOpen: boolean;
  isModalOpen: boolean;
  activeTab: "profile" | "family" | "giving" | "subscriptions" | "invoices";
  scriptsLoaded: boolean;
}

interface UserInfo {
  firstName: string;
  lastName: string;
  email: string;
  imageUrl: string;
}

const TABS = [
  { id: "profile", label: "Profile" },
  { id: "family", label: "Family" },
  { id: "giving", label: "Giving" },
  { id: "subscriptions", label: "Subscriptions" },
  { id: "invoices", label: "Invoices" },
] as const;

export class UserMenuWidget extends MPNextWidget {
  private state: UserMenuState = {
    isDropdownOpen: false,
    isModalOpen: false,
    activeTab: "profile",
    scriptsLoaded: false,
  };

  private portalEl: HTMLDivElement | null = null;
  private portalStyleEl: HTMLStyleElement | null = null;
  private authPollTimer: ReturnType<typeof setInterval> | null = null;
  private expiryTimer: ReturnType<typeof setTimeout> | null = null;
  private isRefreshingToken = false;
  private cachedUserInfo: UserInfo | null = null;
  private fetchingUserInfo = false;
  private userInfoFetchExhausted = false;
  private avatarPhotoUrl: string | null = null;
  private fetchingPhoto = false;
  private userInfoRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private deferredRenderTimer: ReturnType<typeof setTimeout> | null = null;
  private deferredRenderDone = false;
  private pendingDeepLinkTab: UserMenuState["activeTab"] | null = null;
  private suppressHashChange = false;
  private documentClickHandler = (e: MouseEvent) => this.handleDocumentClick(e);
  private escapeHandler = (e: KeyboardEvent) => this.handleEscape(e);
  private storageHandler = () => this.render();
  private hashChangeHandler = () => this.checkHashDeepLink();

  static get observedAttributes() {
    return ["first-name", "last-name", "email", "image-url", "mp-base-url", "prevent-login-widget", "post-logout-redirect-uri"];
  }

  private get mpBaseUrl(): string {
    const attr = this.getAttribute("mp-base-url");
    if (attr) return attr;
    if (!this.mpBaseUrlWarned) {
      this.mpBaseUrlWarned = true;
      console.warn(
        "[next-user-menu] No mp-base-url provided; MP login features are disabled. " +
          "Set the mp-base-url attribute to your MinistryPlatform host.",
      );
    }
    return "";
  }
  private mpBaseUrlWarned = false;

  private get mpWidgetCssUrl(): string {
    // Prefer hashed URL set by the cache-busting loader
    if (window.__nextEmbedCSSUrl) {
      return window.__nextEmbedCSSUrl;
    }
    return `${this.apiHost}/embed-sdk/mp-widget-overrides.css`;
  }

  private get shouldPreventLoginWidget(): boolean {
    return this.hasAttribute("prevent-login-widget");
  }

  private get isAuthenticated(): boolean {
    return this.hasLocalStorageAuth();
  }

  /**
   * Resolve user info from: element attributes → cached userinfo → ID token → sessionStorage
   */
  private getUserInfo(): UserInfo {
    const attrFirst = this.getAttribute("first-name") || "";
    const attrLast = this.getAttribute("last-name") || "";
    if (attrFirst || attrLast) {
      return {
        firstName: attrFirst,
        lastName: attrLast,
        email: this.getAttribute("email") || "",
        imageUrl: this.getAttribute("image-url") || "",
      };
    }

    // Use cached userinfo from OIDC endpoint
    if (this.cachedUserInfo) {
      return this.cachedUserInfo;
    }

    // Fallback: decode ID token for the `name` claim
    let firstName = "";
    let lastName = "";
    let email = "";
    let imageUrl = "";
    try {
      const idToken = localStorage.getItem("mpp-widgets_IdToken");
      if (idToken) {
        const parts = idToken.split(".");
        if (parts.length === 3) {
          const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
          const claims = JSON.parse(atob(payload));
          firstName = claims.given_name || "";
          lastName = claims.family_name || "";
          email = claims.email || "";
          imageUrl = claims.picture || "";
          // If no given/family name, split the name claim
          if (!firstName && !lastName && claims.name) {
            const nameParts = claims.name.split(" ");
            firstName = nameParts[0] || claims.name;
            lastName = nameParts.slice(1).join(" ");
          }
        }
      }
    } catch {
      // token decode failed
    }

    // Last resort: sessionStorage userObj
    if (!firstName && !lastName) {
      try {
        const raw = sessionStorage.getItem("userObj");
        if (raw) {
          const user = JSON.parse(raw);
          firstName = user.First_Name || user.firstName || user.given_name || "";
          lastName = user.Last_Name || user.lastName || user.family_name || "";
          email = email || user.Email_Address || user.email || "";
        }
      } catch {
        // sessionStorage blocked or invalid JSON
      }
    }

    return { firstName, lastName, email, imageUrl };
  }

  /**
   * Fetch user profile from the OIDC userinfo endpoint and cache it.
   * Called once after auth is detected.
   */
  private async fetchUserInfo(attempt = 0): Promise<void> {
    if (this.cachedUserInfo || this.fetchingUserInfo || this.userInfoFetchExhausted) return;
    this.fetchingUserInfo = true;

    try {
      const token = localStorage.getItem("mpp-widgets_AuthToken");
      if (!token) {
        this.fetchingUserInfo = false;
        return;
      }

      const res = await fetch(
        `${this.mpBaseUrl}/ministryplatformapi/oauth/connect/userinfo`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      this.cachedUserInfo = {
        firstName: data.given_name || data.ext_First_Name || "",
        lastName: data.family_name || data.ext_Last_Name || "",
        email: data.email || data.ext_Email_Address || "",
        imageUrl: data.picture || data.ext_Picture || "",
      };
      this.fetchingUserInfo = false;

      // Re-render with the fetched data
      this.render();
    } catch {
      // Retry up to 3 times — token may not be ready immediately after OAuth redirect
      if (attempt < 3 && this.isAuthenticated) {
        // Keep fetchingUserInfo true to prevent duplicate chains
        this.userInfoRetryTimer = setTimeout(() => {
          this.fetchingUserInfo = false;
          this.fetchUserInfo(attempt + 1);
        }, 1000 * (attempt + 1));
      } else {
        this.fetchingUserInfo = false;
        this.userInfoFetchExhausted = true;

        // If userinfo failed AND we have no ID token claims, the token is invalid
        // (e.g. MP login widget wrote a partial token before login completed).
        // Clear tokens and re-render to show the login widget.
        const user = this.getUserInfo();
        if (!user.firstName && !user.lastName) {
          this.clearAllMppTokens();
          this.render();
        }
      }
    }
  }

  /**
   * Fetch the user's profile photo from our API and cache it as an object URL.
   */
  private async fetchAvatarPhoto(): Promise<void> {
    if (this.avatarPhotoUrl || this.fetchingPhoto) return;
    this.fetchingPhoto = true;

    try {
      const res = await this.fetch("/api/embed/profile/photo?thumbnail=true");
      if (!res.ok) {
        this.fetchingPhoto = false;
        return;
      }
      const blob = await res.blob();
      this.avatarPhotoUrl = URL.createObjectURL(blob);
      this.fetchingPhoto = false;
      this.render();
    } catch {
      this.fetchingPhoto = false;
    }
  }

  connectedCallback() {
    this.injectStyles(this.getStyles());
    this.render();
    document.addEventListener("click", this.documentClickHandler, true);
    document.addEventListener("keydown", this.escapeHandler);
    window.addEventListener("storage", this.storageHandler);
    window.addEventListener("hashchange", this.hashChangeHandler);
    this.checkHashDeepLink();
  }

  disconnectedCallback() {
    document.removeEventListener("click", this.documentClickHandler, true);
    document.removeEventListener("keydown", this.escapeHandler);
    window.removeEventListener("storage", this.storageHandler);
    window.removeEventListener("hashchange", this.hashChangeHandler);
    this.stopAuthPoll();
    this.clearExpiryTimer();
    this.clearUserInfoRetry();
    this.destroyPortal();
    if (this.avatarPhotoUrl) {
      URL.revokeObjectURL(this.avatarPhotoUrl);
      this.avatarPhotoUrl = null;
    }
  }

  attributeChangedCallback() {
    if (this.root) {
      this.render();
    }
  }

  // ── Deep-Link Helpers ────────────────────────────────────────

  private parseTabFromHash(): UserMenuState["activeTab"] | null {
    const hash = window.location.hash;
    if (!hash) return null;
    const params = new URLSearchParams(hash.slice(1));
    const tabId = params.get("nw-tab");
    if (!tabId) return null;
    const valid = TABS.find((t) => t.id === tabId);
    return valid ? (valid.id as UserMenuState["activeTab"]) : null;
  }

  private checkHashDeepLink() {
    if (this.suppressHashChange) return;
    const tab = this.parseTabFromHash();
    if (!tab) return;

    if (this.isAuthenticated) {
      this.openModal(tab);
    } else {
      this.pendingDeepLinkTab = tab;
    }
  }

  render() {
    const authenticated = this.isAuthenticated;

    // Manage light DOM login widget and userinfo fetch
    if (authenticated) {
      this.removeLightDOMLogin();
      this.stopAuthPoll();
      this.scheduleExpiryTimer();
      this.fetchUserInfo();
      this.fetchAvatarPhoto();

      // Deep-link: if user arrived with #nw-tab=... before auth, open modal now
      if (this.pendingDeepLinkTab) {
        const tab = this.pendingDeepLinkTab;
        this.pendingDeepLinkTab = null;
        // Defer so the render cycle completes first
        setTimeout(() => this.openModal(tab), 0);
      }
    } else {
      this.clearExpiryTimer();
      this.cachedUserInfo = null;
      if (this.avatarPhotoUrl) {
        URL.revokeObjectURL(this.avatarPhotoUrl);
        this.avatarPhotoUrl = null;
      }
      this.fetchingPhoto = false;
      if (!this.shouldPreventLoginWidget) {
        this.ensureLightDOMLogin();
      }
      this.startAuthPoll();
      // Page loaded with a present-but-expired token — attempt silent refresh
      if (!this.isRefreshingToken && this.hasExpiredToken()) {
        void this.handleTokenExpiry();
      }
    }

    // Render Shadow DOM content
    const container = this.root.querySelector(".nw-user-menu") as HTMLElement;
    const html = authenticated
      ? this.renderAuthenticated()
      : `<slot></slot>`;

    if (container) {
      container.innerHTML = html;
    } else {
      const wrapper = document.createElement("div");
      wrapper.className = "nw-user-menu";
      wrapper.innerHTML = html;
      this.root.appendChild(wrapper);
    }

    if (authenticated) {
      this.attachShadowListeners();

      // If user info is still empty (tokens may be stored asynchronously by MP widget),
      // schedule a quick re-render to pick up the ID token once it's available
      const user = this.getUserInfo();
      if (!user.firstName && !user.lastName && !this.cachedUserInfo && !this.deferredRenderDone) {
        if (!this.deferredRenderTimer) {
          this.deferredRenderDone = true;
          this.deferredRenderTimer = setTimeout(() => {
            this.deferredRenderTimer = null;
            this.render();
          }, 300);
        }
      }
    }
  }

  // ── Unauthenticated: MP Login Widget via light DOM + slot ────

  private ensureLightDOMLogin() {
    if (this.querySelector("mpp-user-login")) return;
    const login = document.createElement("mpp-user-login");
    this.appendChild(login);
  }

  private removeLightDOMLogin() {
    const login = this.querySelector("mpp-user-login");
    if (login) login.remove();
  }

  /**
   * Poll localStorage to detect when the MP login widget sets auth tokens.
   * The `storage` event only fires for cross-tab changes, so we poll for same-tab.
   */
  private startAuthPoll() {
    if (this.authPollTimer) return;
    this.authPollTimer = setInterval(() => {
      if (this.hasLocalStorageAuth()) {
        this.render();
      }
    }, 1000);
  }

  private stopAuthPoll() {
    if (this.authPollTimer) {
      clearInterval(this.authPollTimer);
      this.authPollTimer = null;
    }
  }

  private scheduleExpiryTimer(): void {
    this.clearExpiryTimer();
    try {
      const expiresAfter = localStorage.getItem("mpp-widgets_ExpiresAfter");
      if (!expiresAfter) return;
      const expiryDate = new Date(expiresAfter);
      if (isNaN(expiryDate.getTime())) return;
      const msUntilExpiry = expiryDate.getTime() - Date.now();
      if (msUntilExpiry <= 0) {
        void this.handleTokenExpiry();
        return;
      }
      this.expiryTimer = setTimeout(() => void this.handleTokenExpiry(), msUntilExpiry);
    } catch {}
  }

  private clearExpiryTimer(): void {
    if (this.expiryTimer) {
      clearTimeout(this.expiryTimer);
      this.expiryTimer = null;
    }
  }

  private async handleTokenExpiry(): Promise<void> {
    if (this.isRefreshingToken) return;
    this.isRefreshingToken = true;
    try {
      const res = await fetch(`${this.apiHost}/api/auth/session-tokens`);
      if (res.ok) {
        const data = await res.json() as {
          authenticated?: boolean;
          accessToken?: string;
          idToken?: string;
          refreshToken?: string;
          expiresAt?: number;
        };
        if (data.authenticated && data.accessToken) {
          localStorage.setItem("mpp-widgets_AuthToken", data.accessToken);
          if (data.idToken) localStorage.setItem("mpp-widgets_IdToken", data.idToken);
          if (data.refreshToken) localStorage.setItem("mpp-widgets_Refresh", data.refreshToken);
          if (data.expiresAt) {
            const d = new Date(data.expiresAt * 1000);
            localStorage.setItem("mpp-widgets_ExpiresAfter", d.toString());
          }
          this.isRefreshingToken = false;
          this.scheduleExpiryTimer();
          this.render();
          return;
        }
      }
    } catch {}
    // Refresh failed or session expired — clear tokens and show login
    this.isRefreshingToken = false;
    this.clearAllMppTokens();
    this.render();
  }

  private clearUserInfoRetry() {
    if (this.userInfoRetryTimer) {
      clearTimeout(this.userInfoRetryTimer);
      this.userInfoRetryTimer = null;
    }
    if (this.deferredRenderTimer) {
      clearTimeout(this.deferredRenderTimer);
      this.deferredRenderTimer = null;
    }
  }

  // ── Authenticated: Avatar + Dropdown ─────────────────────────

  private renderAuthenticated(): string {
    return this.renderAvatar() + this.renderDropdown();
  }

  private renderAvatar(): string {
    const user = this.getUserInfo();
    const initials = this.getInitials(user);
    const photoSrc = this.avatarPhotoUrl || user.imageUrl;

    if (photoSrc) {
      return `
        <button class="nw-avatar-btn" aria-label="User menu" aria-haspopup="true" aria-expanded="${this.state.isDropdownOpen}">
          <img class="nw-avatar-img" src="${this.escapeHtml(photoSrc)}" alt="${this.escapeHtml(user.firstName)} ${this.escapeHtml(user.lastName)}" />
        </button>
      `;
    }
    return `
      <button class="nw-avatar-btn" aria-label="User menu" aria-haspopup="true" aria-expanded="${this.state.isDropdownOpen}">
        <span class="nw-avatar-initials">${this.escapeHtml(initials)}</span>
      </button>
    `;
  }

  private renderDropdown(): string {
    if (!this.state.isDropdownOpen) return "";
    const user = this.getUserInfo();

    return `
      <div class="nw-dropdown">
        <div class="nw-dropdown-header">
          <div class="nw-dropdown-name">${this.escapeHtml(user.firstName)} ${this.escapeHtml(user.lastName)}</div>
          ${user.email ? `<div class="nw-dropdown-email">${this.escapeHtml(user.email)}</div>` : ""}
        </div>
        <div class="nw-dropdown-divider"></div>
        <button class="nw-dropdown-item" data-action="account">
          <svg class="nw-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          My Account
        </button>
        ${this.isTaxSeason() ? `<button class="nw-dropdown-item" data-action="giving">
          <svg class="nw-icon" style="stroke: #F1BE48;" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
          Contribution Statement
        </button>` : ""}
        <button class="nw-dropdown-item" data-action="logout">
          <svg class="nw-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
          Log out
        </button>
      </div>
    `;
  }

  private isTaxSeason(): boolean {
    const now = new Date();
    const month = now.getMonth();
    const day = now.getDate();
    // Dec 15 – Apr 15
    return month <= 2 || (month === 3 && day <= 15) || (month === 11 && day >= 15);
  }

  private getInitials(user: UserInfo): string {
    const first = user.firstName.charAt(0).toUpperCase();
    const last = user.lastName.charAt(0).toUpperCase();
    return first + last || "?";
  }

  // ── Event Listeners ──────────────────────────────────────────

  private attachShadowListeners() {
    const avatarBtn = this.root.querySelector(".nw-avatar-btn");
    if (avatarBtn) {
      avatarBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.toggleDropdown();
      });
    }

    const accountBtn = this.root.querySelector('[data-action="account"]');
    if (accountBtn) {
      accountBtn.addEventListener("click", () => {
        this.closeDropdown();
        this.openModal("profile");
      });
    }

    const givingBtn = this.root.querySelector('[data-action="giving"]');
    if (givingBtn) {
      givingBtn.addEventListener("click", () => {
        this.closeDropdown();
        this.openModal("giving");
      });
    }

    const logoutBtn = this.root.querySelector('[data-action="logout"]');
    if (logoutBtn) {
      logoutBtn.addEventListener("click", () => {
        this.handleLogout();
      });
    }
  }

  private toggleDropdown() {
    this.state.isDropdownOpen = !this.state.isDropdownOpen;
    this.render();
  }

  private closeDropdown() {
    if (this.state.isDropdownOpen) {
      this.state.isDropdownOpen = false;
      this.render();
    }
  }

  private handleDocumentClick(e: MouseEvent) {
    if (!this.state.isDropdownOpen) return;

    const path = e.composedPath();
    if (!path.includes(this)) {
      this.closeDropdown();
    }
  }

  private handleEscape(e: KeyboardEvent) {
    if (e.key === "Escape") {
      if (this.state.isModalOpen) {
        this.closeModal();
      } else if (this.state.isDropdownOpen) {
        this.closeDropdown();
      }
    }
  }

  // ── Modal (portal to document.body) ──────────────────────────

  private openModal(tab?: UserMenuState["activeTab"]) {
    if (tab) this.state.activeTab = tab;
    this.state.isModalOpen = true;

    // Update URL hash to reflect active tab
    this.suppressHashChange = true;
    window.location.hash = `nw-tab=${this.state.activeTab}`;
    this.suppressHashChange = false;

    this.createPortal();
    this.loadMPWidgets();

    this.emit("accountModalOpen", { tab: this.state.activeTab });
  }

  private closeModal() {
    this.state.isModalOpen = false;
    this.destroyPortal();

    // Clean #nw-tab=... from URL without adding a history entry
    if (this.parseTabFromHash()) {
      this.suppressHashChange = true;
      history.replaceState(null, "", window.location.pathname + window.location.search);
      this.suppressHashChange = false;
    }

    this.emit("accountModalClose", {});
  }

  private injectPortalStyles() {
    if (document.getElementById("nw-user-menu-portal-styles")) return;

    const style = document.createElement("style");
    style.id = "nw-user-menu-portal-styles";
    style.textContent = this.getPortalStyles();
    document.head.appendChild(style);
    this.portalStyleEl = style;
  }

  private createPortal() {
    this.destroyPortal();
    this.injectPortalStyles();

    const portal = document.createElement("div");
    portal.id = "nw-user-menu-portal";
    portal.className = "nw-modal-overlay";
    portal.innerHTML = this.renderModal();
    document.body.appendChild(portal);
    this.portalEl = portal;

    document.body.style.overflow = "hidden";

    this.attachPortalListeners();
  }

  private destroyPortal() {
    if (this.portalEl) {
      this.portalEl.remove();
      this.portalEl = null;
    }
    if (this.portalStyleEl) {
      this.portalStyleEl.remove();
      this.portalStyleEl = null;
    }
    document.body.style.overflow = "";
  }

  private renderModal(): string {
    return `
      <div class="nw-modal-backdrop"></div>
      <div class="nw-modal-container" role="dialog" aria-modal="true" aria-label="My Account">
        <div class="nw-modal-header">
          <div>
            <h2 class="nw-modal-title">My Account</h2>
            <p class="nw-modal-description">Manage your account settings and preferences.</p>
          </div>
          <button class="nw-modal-close" aria-label="Close" data-action="close-modal">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div class="nw-modal-tabs">
          ${TABS.map(
            (tab) => `
            <button class="nw-tab${this.state.activeTab === tab.id ? " active" : ""}" data-tab="${tab.id}">
              ${tab.label}
            </button>
          `
          ).join("")}
        </div>
        <div class="nw-modal-body">
          ${this.renderTabContent()}
        </div>
      </div>
    `;
  }

  private renderTabContent(): string {
    switch (this.state.activeTab) {
      case "profile":
        return `<div class="nw-tab-panel" data-panel="profile">
          <next-profile api-host="${this.escapeHtml(this.apiHost)}"></next-profile>
        </div>`;
      case "family":
        return `<div class="nw-tab-panel" data-panel="family">
          <mpp-household hideaddhouseholdmember="false" customcss="${this.mpWidgetCssUrl}"></mpp-household>
        </div>`;
      case "giving": {
        const statementOnTop = this.isTaxSeason();

        const css = this.mpWidgetCssUrl;
        const statement = `<mpp-my-contribution-statement customcss="${css}"></mpp-my-contribution-statement>`;
        const giving = `<mpp-my-giving hidesoftcredits="true" customcss="${css}"></mpp-my-giving>`;
        const pledges = `<mpp-my-pledges hidecancelbutton="true" customcss="${css}"></mpp-my-pledges>`;

        return statementOnTop
          ? `<div class="nw-tab-panel" data-panel="giving">${statement}${giving}${pledges}</div>`
          : `<div class="nw-tab-panel" data-panel="giving">${giving}${pledges}${statement}</div>`;
      }
      case "subscriptions":
        return `<div class="nw-tab-panel" data-panel="subscriptions">
          <next-subscriptions api-host="${this.escapeHtml(this.apiHost)}"></next-subscriptions>
        </div>`;
      case "invoices":
        return `<div class="nw-tab-panel" data-panel="invoices">
          <next-my-invoices api-host="${this.escapeHtml(this.apiHost)}"></next-my-invoices>
        </div>`;
    }
  }

  private attachPortalListeners() {
    if (!this.portalEl) return;

    const backdrop = this.portalEl.querySelector(".nw-modal-backdrop");
    if (backdrop) {
      backdrop.addEventListener("click", () => this.closeModal());
    }

    const closeBtn = this.portalEl.querySelector('[data-action="close-modal"]');
    if (closeBtn) {
      closeBtn.addEventListener("click", () => this.closeModal());
    }

    const tabBtns = this.portalEl.querySelectorAll(".nw-tab");
    tabBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        const tab = (btn as HTMLElement).dataset.tab as UserMenuState["activeTab"];
        this.switchTab(tab);
      });
    });
  }

  private switchTab(tab: UserMenuState["activeTab"]) {
    if (this.state.activeTab === tab) return;
    this.state.activeTab = tab;

    // Update URL hash to reflect active tab
    this.suppressHashChange = true;
    window.location.hash = `nw-tab=${tab}`;
    this.suppressHashChange = false;

    if (!this.portalEl) return;

    const tabBtns = this.portalEl.querySelectorAll(".nw-tab");
    tabBtns.forEach((btn) => {
      const btnTab = (btn as HTMLElement).dataset.tab;
      btn.classList.toggle("active", btnTab === tab);
    });

    const body = this.portalEl.querySelector(".nw-modal-body");
    if (body) {
      body.innerHTML = this.renderTabContent();
    }
  }

  // ── MP Widget Scripts ────────────────────────────────────────

  private loadMPWidgets() {
    if (this.state.scriptsLoaded || document.getElementById("MPWidgets")) {
      return;
    }

    const base = `${this.mpBaseUrl}/widgets/dist`;
    const scripts = [
      "MPWidgets.js",
      "MyGiving.js",
      "MyPledges.js",
      "MyContributionStatement.js",
      "Household.js",
    ];

    scripts.forEach((file, i) => {
      const script = document.createElement("script");
      if (i === 0) script.id = "MPWidgets";
      script.src = `${base}/${file}`;
      script.async = true;
      document.head.appendChild(script);
    });

    this.state.scriptsLoaded = true;
  }

  // ── Auth Helpers ─────────────────────────────────────────────

  private hasLocalStorageAuth(): boolean {
    try {
      const token = localStorage.getItem("mpp-widgets_AuthToken");
      if (!token) return false;
      const expiresAfter = localStorage.getItem("mpp-widgets_ExpiresAfter");
      if (expiresAfter) {
        const expiryDate = new Date(expiresAfter);
        if (!isNaN(expiryDate.getTime()) && expiryDate <= new Date()) {
          return false; // token present but expired
        }
      }
      return true;
    } catch {
      return false;
    }
  }

  private hasExpiredToken(): boolean {
    try {
      const token = localStorage.getItem("mpp-widgets_AuthToken");
      if (!token) return false;
      const expiresAfter = localStorage.getItem("mpp-widgets_ExpiresAfter");
      if (!expiresAfter) return false;
      const expiryDate = new Date(expiresAfter);
      return !isNaN(expiryDate.getTime()) && expiryDate <= new Date();
    } catch {
      return false;
    }
  }

  private clearAllMppTokens(): void {
    const keys = [
      "mpp-widgets_AuthToken",
      "mpp-widgets_IdToken",
      "mpp-widgets_ExpiresAfter",
      "mpp-widgets_Refresh",
    ];
    keys.forEach((key) => {
      try { localStorage.removeItem(key); } catch {}
    });
    try { sessionStorage.removeItem("userObj"); } catch {}
  }

  private handleLogout() {
    // Read ID token BEFORE clearing localStorage — needed for end-session URL
    const idToken = (() => { try { return localStorage.getItem("mpp-widgets_IdToken"); } catch { return null; } })();

    this.clearAllMppTokens();

    this.cachedUserInfo = null;
    this.deferredRenderDone = false;
    this.userInfoFetchExhausted = false;
    this.clearUserInfoRetry();
    this.closeDropdown();
    this.closeModal();
    const postLogoutRedirectUri = this.getAttribute("post-logout-redirect-uri") || window.location.href;
    const endSessionUrl = new URL(`${this.mpBaseUrl}/ministryplatformapi/oauth/connect/endsession`);
    if (idToken) endSessionUrl.searchParams.set("id_token_hint", idToken);
    if (postLogoutRedirectUri) endSessionUrl.searchParams.set("post_logout_redirect_uri", postLogoutRedirectUri);

    // Emit cancelable event — TokenBridge calls preventDefault() if present
    const event = new CustomEvent("userLogout", {
      detail: { endSessionUrl: endSessionUrl.toString(), postLogoutRedirectUri },
      bubbles: true,
      composed: true,
      cancelable: true,
    });
    const handled = !this.dispatchEvent(event);

    if (!handled) {
      // No TokenBridge — redirect to MP end-session directly
      window.location.href = endSessionUrl.toString();
      return;
    }

    // TokenBridge is handling the redirect — re-render to show login state
    this.render();
  }

  // ── Utility ──────────────────────────────────────────────────

  private escapeHtml(str: string): string {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  // ── Styles ───────────────────────────────────────────────────

  private getStyles(): string {
    return `
      :host {
        all: initial;
        display: inline-block;
        font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
      }

      .nw-user-menu {
        position: relative;
        display: inline-block;
      }

      /* Avatar button */
      .nw-avatar-btn {
        width: 36px;
        height: 36px;
        border-radius: 50%;
        border: none;
        padding: 0;
        cursor: pointer;
        background: #004C97;
        color: white;
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
        outline: none;
        transition: box-shadow 0.15s;
      }

      .nw-avatar-btn:focus-visible {
        box-shadow: 0 0 0 2px white, 0 0 0 4px #004C97;
      }

      .nw-avatar-btn:hover {
        opacity: 0.9;
      }

      .nw-avatar-img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        border-radius: 50%;
      }

      .nw-avatar-initials {
        font-size: 14px;
        font-weight: 600;
        line-height: 1;
        user-select: none;
      }

      /* Dropdown */
      .nw-dropdown {
        position: absolute;
        top: calc(100% + 6px);
        right: 0;
        width: 224px;
        background: white;
        border: 1px solid #e5e7eb;
        border-radius: 8px;
        box-shadow: 0 10px 15px -3px rgba(0,0,0,.1), 0 4px 6px -4px rgba(0,0,0,.1);
        z-index: 50;
        overflow: hidden;
        animation: nw-fade-in 0.12s ease-out;
      }

      @keyframes nw-fade-in {
        from { opacity: 0; transform: translateY(-4px); }
        to { opacity: 1; transform: translateY(0); }
      }

      .nw-dropdown-header {
        padding: 12px 16px;
      }

      .nw-dropdown-name {
        font-size: 14px;
        font-weight: 500;
        color: #1f2937;
      }

      .nw-dropdown-email {
        font-size: 12px;
        color: #6b7280;
        margin-top: 2px;
      }

      .nw-dropdown-divider {
        height: 1px;
        background: #e5e7eb;
      }

      .nw-dropdown-item {
        display: flex;
        align-items: center;
        gap: 8px;
        width: 100%;
        padding: 10px 16px;
        border: none;
        background: none;
        font-size: 14px;
        color: #1f2937;
        cursor: pointer;
        text-align: left;
        font-family: inherit;
      }

      .nw-dropdown-item:hover {
        background: #f3f4f6;
      }

      .nw-icon {
        width: 16px;
        height: 16px;
        flex-shrink: 0;
      }
    `;
  }

  private getPortalStyles(): string {
    return `
      .nw-modal-overlay {
        position: fixed;
        inset: 0;
        z-index: 999999;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .nw-modal-backdrop {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.5);
        animation: nw-backdrop-in 0.2s ease-out;
      }

      @keyframes nw-backdrop-in {
        from { opacity: 0; }
        to { opacity: 1; }
      }

      .nw-modal-container {
        position: relative;
        background: white;
        border-radius: 12px;
        box-shadow: 0 25px 50px -12px rgba(0,0,0,.25);
        width: 90vw;
        max-width: 900px;
        max-height: 85vh;
        display: flex;
        flex-direction: column;
        animation: nw-modal-in 0.2s ease-out;
        font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
      }

      @keyframes nw-modal-in {
        from { opacity: 0; transform: scale(0.95); }
        to { opacity: 1; transform: scale(1); }
      }

      .nw-modal-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        padding: 24px 24px 16px;
        border-bottom: 1px solid #e5e7eb;
      }

      .nw-modal-title {
        font-size: 18px;
        font-weight: 600;
        color: #1f2937;
        margin: 0;
        line-height: 1.4;
      }

      .nw-modal-description {
        font-size: 14px;
        color: #6b7280;
        margin: 4px 0 0;
      }

      .nw-modal-close {
        width: 32px;
        height: 32px;
        display: flex;
        align-items: center;
        justify-content: center;
        border: none;
        background: none;
        border-radius: 6px;
        cursor: pointer;
        color: #6b7280;
        padding: 0;
        flex-shrink: 0;
      }

      .nw-modal-close:hover {
        background: #f3f4f6;
        color: #1f2937;
      }

      .nw-modal-close svg {
        width: 18px;
        height: 18px;
      }

      /* Tabs */
      .nw-modal-tabs {
        display: flex;
        padding: 0 24px;
        border-bottom: 1px solid #e5e7eb;
        gap: 0;
      }

      .nw-tab {
        flex: 1;
        padding: 12px 16px;
        border: none;
        background: none;
        font-size: 14px;
        font-weight: 500;
        color: #6b7280;
        cursor: pointer;
        border-bottom: 2px solid transparent;
        transition: color 0.15s, border-color 0.15s;
        font-family: inherit;
      }

      .nw-tab:hover {
        color: #1f2937;
      }

      .nw-tab.active {
        color: #004C97;
        border-bottom-color: #004C97;
      }

      /* Modal body */
      .nw-modal-body {
        padding: 24px;
        overflow-y: auto;
        flex: 1;
        min-height: 200px;
      }

      .nw-tab-panel {
        min-height: 150px;
      }

      .nw-tab-empty {
        text-align: center;
        color: #9ca3af;
        font-size: 14px;
        padding: 48px 0;
      }

      @media (max-width: 640px) {
        .nw-modal-container {
          width: 95vw;
          max-height: 90vh;
        }

        .nw-modal-header {
          padding: 16px 16px 12px;
        }

        .nw-modal-tabs {
          padding: 0 16px;
        }

        .nw-tab {
          padding: 10px 8px;
          font-size: 13px;
        }

        .nw-modal-body {
          padding: 16px;
        }
      }
    `;
  }
}

customElements.define("next-user-menu", UserMenuWidget);
