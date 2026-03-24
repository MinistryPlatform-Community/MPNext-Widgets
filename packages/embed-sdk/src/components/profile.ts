import { MPNextWidget } from "../shared/base-widget";

interface ProfileData {
  Contact_ID: number;
  Contact_GUID: string;
  Prefix_ID: number | null;
  First_Name: string;
  Middle_Name: string | null;
  Last_Name: string;
  Nickname: string | null;
  Suffix_ID: number | null;
  Gender_ID: number | null;
  Date_of_Birth: string | null;
  Marital_Status_ID: number | null;
  Mobile_Phone: string | null;
  Company_Phone: string | null;
  Email_Address: string | null;
  Do_Not_Text: boolean;
  Bulk_Email_Opt_Out: boolean;
  Prefix: string | null;
  Suffix: string | null;
  Gender: string | null;
  Marital_Status: string | null;
}

interface LookupOption {
  id: number;
  label: string;
}

interface ProfileLookups {
  prefixes: LookupOption[];
  suffixes: LookupOption[];
  genders: LookupOption[];
  maritalStatuses: LookupOption[];
}

interface ValidationErrors {
  [key: string]: string;
}

export class ProfileWidget extends MPNextWidget {
  private loading = true;
  private saving = false;
  private savingPassword = false;
  private error: string | null = null;
  private saveSuccess = false;
  private passwordSuccess = false;
  private passwordError: string | null = null;
  private profile: ProfileData | null = null;
  private lookups: ProfileLookups | null = null;
  private validationErrors: ValidationErrors = {};
  private passwordErrors: ValidationErrors = {};
  private showOldPassword = false;
  private showNewPassword = false;
  private showConfirmPassword = false;
  private successTimer: ReturnType<typeof setTimeout> | null = null;
  private passwordSuccessTimer: ReturnType<typeof setTimeout> | null = null;
  private photoUrl: string | null = null;
  private uploadingPhoto = false;

  connectedCallback() {
    this.injectStyles(this.getStyles());
    this.render();
    this.loadProfile();
  }

  disconnectedCallback() {
    if (this.successTimer) clearTimeout(this.successTimer);
    if (this.passwordSuccessTimer) clearTimeout(this.passwordSuccessTimer);
    if (this.photoUrl) URL.revokeObjectURL(this.photoUrl);
  }

  private async loadProfile() {
    this.loading = true;
    this.error = null;
    this.render();

    try {
      const res = await this.fetch("/api/embed/profile");
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error || `Failed to load profile (${res.status})`);
      }
      const data = await res.json();
      this.profile = data.profile;
      this.lookups = data.lookups;
      this.loading = false;
      this.render();
      this.emit("profileLoaded", { contactId: this.profile?.Contact_ID });

      // Load profile photo (non-blocking)
      this.loadPhoto();
    } catch (err) {
      this.loading = false;
      this.error = err instanceof Error ? err.message : "Failed to load profile";
      this.render();
      this.emit("profileError", { error: this.error });
    }
  }

  private async loadPhoto() {
    try {
      const res = await this.fetch("/api/embed/profile/photo");
      if (!res.ok) return;
      const blob = await res.blob();
      if (this.photoUrl) URL.revokeObjectURL(this.photoUrl);
      this.photoUrl = URL.createObjectURL(blob);
      const img = this.root.querySelector(".nw-photo-img") as HTMLImageElement | null;
      if (img) {
        img.src = this.photoUrl;
        img.classList.add("nw-photo-loaded");
      }
      const placeholder = this.root.querySelector(".nw-photo-placeholder");
      if (placeholder) placeholder.classList.add("nw-hidden");
    } catch {
      // Silently ignore photo load errors
    }
  }

  private async handlePhotoUpload(file: File) {
    const allowedTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"];
    if (!allowedTypes.includes(file.type)) {
      this.error = "Please upload a JPEG, PNG, GIF, or WebP image.";
      this.render();
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      this.error = "Photo must be under 5MB.";
      this.render();
      return;
    }

    this.uploadingPhoto = true;
    this.error = null;
    this.render();

    try {
      const formData = new FormData();
      formData.append("photo", file);

      const res = await this.fetch("/api/embed/profile/photo", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to upload photo");
      }

      this.uploadingPhoto = false;
      this.render();
      this.loadPhoto();
    } catch (err) {
      this.uploadingPhoto = false;
      this.error = err instanceof Error ? err.message : "Failed to upload photo";
      this.render();
    }
  }

  render() {
    const container = this.root.querySelector(".nw-profile") || document.createElement("div");
    container.className = "nw-profile";

    if (this.loading) {
      container.innerHTML = `
        <div class="nw-loading">
          <div class="nw-spinner"></div>
          <p>Loading profile...</p>
        </div>`;
      if (!this.root.querySelector(".nw-profile")) this.root.appendChild(container);
      return;
    }

    if (this.error && !this.profile) {
      container.innerHTML = `
        <div class="nw-error-box">
          <p>${this.esc(this.error)}</p>
          <button class="nw-btn nw-btn-primary" data-action="retry">Try Again</button>
        </div>`;
      if (!this.root.querySelector(".nw-profile")) this.root.appendChild(container);
      this.root.querySelector('[data-action="retry"]')?.addEventListener("click", () => this.loadProfile());
      return;
    }

    if (!this.profile || !this.lookups) return;

    const p = this.profile;
    const l = this.lookups;

    // Parse DOB
    let dobMonth = "";
    let dobDay = "";
    let dobYear = "";
    if (p.Date_of_Birth) {
      const match = p.Date_of_Birth.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (match) {
        dobYear = String(parseInt(match[1]));
        dobMonth = String(parseInt(match[2]));
        dobDay = String(parseInt(match[3]));
      }
    }

    container.innerHTML = `
      <div class="nw-photo-section">
        <div class="nw-photo-wrap">
          <img class="nw-photo-img${this.photoUrl ? " nw-photo-loaded" : ""}" src="${this.photoUrl || ""}" alt="Profile photo" />
          <div class="nw-photo-placeholder${this.photoUrl ? " nw-hidden" : ""}">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#9E9E9E" stroke-width="1.5"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          </div>
          <button type="button" class="nw-photo-btn" ${this.uploadingPhoto ? "disabled" : ""}>
            ${this.uploadingPhoto
              ? '<span class="nw-spinner-sm"></span>'
              : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2D2926" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>'}
          </button>
          <input type="file" class="nw-photo-input" accept="image/jpeg,image/png,image/gif,image/webp" />
        </div>
        <div class="nw-photo-text">
          <div class="nw-photo-greeting">Hi, ${this.esc(this.profile?.Nickname || this.profile?.First_Name || "")} ${this.esc(this.profile?.Last_Name || "")}!</div>
          <p class="nw-photo-subtext">Enter your information below, then click Save. This will only be visible to church staff unless you choose to share it with others.</p>
        </div>
      </div>

      ${this.saveSuccess ? '<div class="nw-toast nw-toast-success">Profile saved successfully.</div>' : ""}
      ${this.error ? `<div class="nw-toast nw-toast-error">${this.esc(this.error)}</div>` : ""}

      <form id="profile-form" novalidate>
        <fieldset class="nw-section">
          <legend class="nw-section-label">Name</legend>
          <div class="nw-grid">
            <div class="nw-field">
              <label for="Prefix_ID">Prefix</label>
              <select id="Prefix_ID" name="Prefix_ID">
                <option value="">—</option>
                ${l.prefixes.map((o) => `<option value="${o.id}"${p.Prefix_ID === o.id ? " selected" : ""}>${this.esc(o.label)}</option>`).join("")}
              </select>
            </div>
            <div class="nw-field">
              <label for="First_Name">First Name *</label>
              <input id="First_Name" name="First_Name" type="text" value="${this.esc(p.First_Name || "")}" required />
              ${this.fieldError("First_Name")}
            </div>
            <div class="nw-field">
              <label for="Middle_Name">Middle Name</label>
              <input id="Middle_Name" name="Middle_Name" type="text" value="${this.esc(p.Middle_Name || "")}" />
            </div>
            <div class="nw-field">
              <label for="Last_Name">Last Name *</label>
              <input id="Last_Name" name="Last_Name" type="text" value="${this.esc(p.Last_Name || "")}" required />
              ${this.fieldError("Last_Name")}
            </div>
            <div class="nw-field">
              <label for="Nickname">Nickname</label>
              <input id="Nickname" name="Nickname" type="text" value="${this.esc(p.Nickname || "")}" />
            </div>
            <div class="nw-field">
              <label for="Suffix_ID">Suffix</label>
              <select id="Suffix_ID" name="Suffix_ID">
                <option value="">—</option>
                ${l.suffixes.map((o) => `<option value="${o.id}"${p.Suffix_ID === o.id ? " selected" : ""}>${this.esc(o.label)}</option>`).join("")}
              </select>
            </div>
          </div>
        </fieldset>

        <fieldset class="nw-section">
          <legend class="nw-section-label">Personal Details</legend>
          <div class="nw-grid">
            <div class="nw-field">
              <label for="Gender_ID">Gender</label>
              <select id="Gender_ID" name="Gender_ID">
                <option value="">—</option>
                ${l.genders.map((o) => `<option value="${o.id}"${p.Gender_ID === o.id ? " selected" : ""}>${this.esc(o.label)}</option>`).join("")}
              </select>
            </div>
            <div class="nw-field nw-field-dob">
              <label>Date of Birth</label>
              <div class="nw-dob-row">
                <select id="dob-month" name="dob-month">
                  <option value="">Month</option>
                  ${Array.from({ length: 12 }, (_, i) => {
                    const m = String(i + 1);
                    const label = new Date(2000, i).toLocaleString("default", { month: "long" });
                    return `<option value="${m}"${dobMonth === m ? " selected" : ""}>${label}</option>`;
                  }).join("")}
                </select>
                <select id="dob-day" name="dob-day">
                  <option value="">Day</option>
                  ${Array.from({ length: 31 }, (_, i) => {
                    const d = String(i + 1);
                    return `<option value="${d}"${dobDay === d ? " selected" : ""}>${d}</option>`;
                  }).join("")}
                </select>
                <select id="dob-year" name="dob-year">
                  <option value="">Year</option>
                  ${(() => {
                    const currentYear = new Date().getFullYear();
                    const years: string[] = [];
                    for (let y = currentYear; y >= currentYear - 120; y--) {
                      const yStr = String(y);
                      years.push(`<option value="${yStr}"${dobYear === yStr ? " selected" : ""}>${yStr}</option>`);
                    }
                    return years.join("");
                  })()}
                </select>
              </div>
            </div>
            <div class="nw-field">
              <label for="Marital_Status_ID">Marital Status</label>
              <select id="Marital_Status_ID" name="Marital_Status_ID">
                <option value="">—</option>
                ${l.maritalStatuses.map((o) => `<option value="${o.id}"${p.Marital_Status_ID === o.id ? " selected" : ""}>${this.esc(o.label)}</option>`).join("")}
              </select>
            </div>
          </div>
        </fieldset>

        <fieldset class="nw-section">
          <legend class="nw-section-label">Contact Information</legend>
          <div class="nw-grid">
            <div class="nw-field">
              <label for="Mobile_Phone">Mobile Phone</label>
              <input id="Mobile_Phone" name="Mobile_Phone" type="tel" value="${this.esc(p.Mobile_Phone || "")}" placeholder="999-999-9999" data-phone />
              ${this.fieldError("Mobile_Phone")}
            </div>
            <div class="nw-field">
              <label for="Company_Phone">Work Phone</label>
              <input id="Company_Phone" name="Company_Phone" type="tel" value="${this.esc(p.Company_Phone || "")}" placeholder="999-999-9999" data-phone />
              ${this.fieldError("Company_Phone")}
            </div>
            <div class="nw-field nw-field-full">
              <label for="Email_Address">Email *</label>
              <input id="Email_Address" name="Email_Address" type="email" value="${this.esc(p.Email_Address || "")}" required />
              ${this.fieldError("Email_Address")}
            </div>
            <div class="nw-field nw-field-full nw-comm-prefs">
              <div class="nw-comm-header">How should we contact you?</div>
              <label class="nw-checkbox-label">
                <input type="checkbox" id="sms-opt-in" ${!p.Do_Not_Text ? "checked" : ""} />
                <div>
                  <span>I agree to opt in to text messages from Northwoods Community Church</span>
                  <small class="nw-checkbox-hint">Message and data rates may apply. Message frequency varies and you may opt out at any time.</small>
                </div>
              </label>
              <label class="nw-checkbox-label">
                <input type="checkbox" id="bulk-email-opt-out" ${p.Bulk_Email_Opt_Out ? "checked" : ""} />
                <span>Do not send me bulk email messages</span>
              </label>
            </div>
          </div>
        </fieldset>

        <div class="nw-actions">
          <button type="submit" class="nw-btn nw-btn-primary" ${this.saving ? "disabled" : ""}>
            ${this.saving ? '<span class="nw-spinner-sm"></span> Saving...' : "Save Profile"}
          </button>
        </div>
      </form>

      <form id="password-form" novalidate>
        <fieldset class="nw-section">
          <legend class="nw-section-label">Change Password</legend>
          ${this.passwordSuccess ? '<div class="nw-toast nw-toast-success">Password changed successfully.</div>' : ""}
          ${this.passwordError ? `<div class="nw-toast nw-toast-error">${this.esc(this.passwordError)}</div>` : ""}
          <div class="nw-grid nw-grid-single">
            <div class="nw-field nw-field-full">
              <label for="oldPassword">Current Password *</label>
              <div class="nw-password-wrap">
                <input id="oldPassword" name="oldPassword" type="${this.showOldPassword ? "text" : "password"}" required autocomplete="current-password" />
                <button type="button" class="nw-eye-btn" data-toggle="oldPassword">${this.eyeIcon(this.showOldPassword)}</button>
              </div>
              ${this.pwError("oldPassword")}
            </div>
            <div class="nw-field nw-field-full">
              <label for="newPassword">New Password *</label>
              <div class="nw-password-wrap">
                <input id="newPassword" name="newPassword" type="${this.showNewPassword ? "text" : "password"}" required autocomplete="new-password" />
                <button type="button" class="nw-eye-btn" data-toggle="newPassword">${this.eyeIcon(this.showNewPassword)}</button>
              </div>
              ${this.pwError("newPassword")}
            </div>
            <div class="nw-field nw-field-full">
              <label for="confirmPassword">Confirm New Password *</label>
              <div class="nw-password-wrap">
                <input id="confirmPassword" name="confirmPassword" type="${this.showConfirmPassword ? "text" : "password"}" required autocomplete="new-password" />
                <button type="button" class="nw-eye-btn" data-toggle="confirmPassword">${this.eyeIcon(this.showConfirmPassword)}</button>
              </div>
              ${this.pwError("confirmPassword")}
            </div>
          </div>
          <div class="nw-actions">
            <button type="submit" class="nw-btn nw-btn-primary" ${this.savingPassword ? "disabled" : ""}>
              ${this.savingPassword ? '<span class="nw-spinner-sm"></span> Saving...' : "Change Password"}
            </button>
          </div>
        </fieldset>
      </form>
    `;

    if (!this.root.querySelector(".nw-profile")) this.root.appendChild(container);
    this.attachFormListeners();
  }

  private attachFormListeners() {
    const profileForm = this.root.querySelector("#profile-form") as HTMLFormElement | null;
    const passwordForm = this.root.querySelector("#password-form") as HTMLFormElement | null;

    profileForm?.addEventListener("submit", (e) => {
      e.preventDefault();
      this.handleProfileSubmit();
    });

    passwordForm?.addEventListener("submit", (e) => {
      e.preventDefault();
      this.handlePasswordSubmit();
    });

    const photoBtn = this.root.querySelector(".nw-photo-btn");
    const photoInput = this.root.querySelector(".nw-photo-input") as HTMLInputElement | null;
    photoBtn?.addEventListener("click", () => photoInput?.click());
    photoInput?.addEventListener("change", () => {
      const file = photoInput.files?.[0];
      if (file) this.handlePhotoUpload(file);
      photoInput.value = "";
    });

    this.root.querySelectorAll("[data-phone]").forEach((input) => {
      input.addEventListener("input", (e) => this.formatPhone(e.target as HTMLInputElement));
    });

    this.root.querySelectorAll(".nw-eye-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const field = (btn as HTMLElement).dataset.toggle;
        if (field === "oldPassword") this.showOldPassword = !this.showOldPassword;
        else if (field === "newPassword") this.showNewPassword = !this.showNewPassword;
        else if (field === "confirmPassword") this.showConfirmPassword = !this.showConfirmPassword;

        const input = this.root.querySelector(`#${field}`) as HTMLInputElement;
        if (input) {
          const isText = field === "oldPassword" ? this.showOldPassword : field === "newPassword" ? this.showNewPassword : this.showConfirmPassword;
          input.type = isText ? "text" : "password";
        }
        (btn as HTMLElement).innerHTML = this.eyeIcon(
          field === "oldPassword" ? this.showOldPassword : field === "newPassword" ? this.showNewPassword : this.showConfirmPassword
        );
      });
    });
  }

  private async handleProfileSubmit() {
    this.validationErrors = {};
    this.error = null;
    this.saveSuccess = false;

    const getValue = (id: string) => (this.root.querySelector(`#${id}`) as HTMLInputElement | HTMLSelectElement)?.value?.trim() ?? "";
    const getChecked = (id: string) => (this.root.querySelector(`#${id}`) as HTMLInputElement)?.checked ?? false;

    const firstName = getValue("First_Name");
    const lastName = getValue("Last_Name");
    const email = getValue("Email_Address");

    const mobilePhone = getValue("Mobile_Phone");
    const companyPhone = getValue("Company_Phone");
    const phoneRegex = /^\d{3}-\d{3}-\d{4}$/;

    if (!firstName) this.validationErrors.First_Name = "First name is required";
    else if (/&/.test(firstName) || /\band\b/i.test(firstName)) this.validationErrors.First_Name = "Please enter only your first name (no \"&\" or \"and\")";
    if (!lastName) this.validationErrors.Last_Name = "Last name is required";
    if (!email) this.validationErrors.Email_Address = "Email is required";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) this.validationErrors.Email_Address = "Invalid email address";
    if (mobilePhone && !phoneRegex.test(mobilePhone)) this.validationErrors.Mobile_Phone = "Use format: 999-999-9999";
    if (companyPhone && !phoneRegex.test(companyPhone)) this.validationErrors.Company_Phone = "Use format: 999-999-9999";

    if (Object.keys(this.validationErrors).length > 0) {
      this.render();
      return;
    }

    const dobMonth = getValue("dob-month");
    const dobDay = getValue("dob-day");
    const dobYear = getValue("dob-year");
    let dateOfBirth: string | null = null;
    if (dobMonth && dobDay && dobYear) {
      dateOfBirth = `${dobYear}-${dobMonth.padStart(2, "0")}-${dobDay.padStart(2, "0")}`;
    }

    const prefixId = getValue("Prefix_ID");
    const suffixId = getValue("Suffix_ID");
    const genderId = getValue("Gender_ID");
    const maritalStatusId = getValue("Marital_Status_ID");

    const body: Record<string, unknown> = {
      First_Name: firstName,
      Last_Name: lastName,
      Middle_Name: getValue("Middle_Name") || null,
      Nickname: getValue("Nickname") || null,
      Email_Address: email,
      Mobile_Phone: getValue("Mobile_Phone") || null,
      Company_Phone: getValue("Company_Phone") || null,
      Do_Not_Text: !getChecked("sms-opt-in"),
      Bulk_Email_Opt_Out: getChecked("bulk-email-opt-out"),
      Prefix_ID: prefixId ? Number(prefixId) : null,
      Suffix_ID: suffixId ? Number(suffixId) : null,
      Gender_ID: genderId ? Number(genderId) : null,
      Marital_Status_ID: maritalStatusId ? Number(maritalStatusId) : null,
      Date_of_Birth: dateOfBirth,
    };

    this.saving = true;
    this.render();

    try {
      const res = await this.fetch("/api/embed/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to save profile");
      }

      if (this.profile) {
        Object.assign(this.profile, body);
      }

      this.saving = false;
      this.saveSuccess = true;
      this.render();
      this.emit("profileSaved", body);

      if (this.successTimer) clearTimeout(this.successTimer);
      this.successTimer = setTimeout(() => {
        this.saveSuccess = false;
        this.render();
      }, 3000);
    } catch (err) {
      this.saving = false;
      this.error = err instanceof Error ? err.message : "Failed to save profile";
      this.render();
      this.emit("profileError", { error: this.error });
    }
  }

  private async handlePasswordSubmit() {
    this.passwordErrors = {};
    this.passwordError = null;
    this.passwordSuccess = false;

    const getValue = (id: string) => (this.root.querySelector(`#${id}`) as HTMLInputElement)?.value ?? "";

    const oldPassword = getValue("oldPassword");
    const newPassword = getValue("newPassword");
    const confirmPassword = getValue("confirmPassword");

    if (!oldPassword) this.passwordErrors.oldPassword = "Current password is required";
    if (!newPassword) this.passwordErrors.newPassword = "New password is required";
    else if (newPassword.length < 8) this.passwordErrors.newPassword = "Must be at least 8 characters";
    if (!confirmPassword) this.passwordErrors.confirmPassword = "Please confirm your new password";
    else if (newPassword !== confirmPassword) this.passwordErrors.confirmPassword = "Passwords do not match";

    if (Object.keys(this.passwordErrors).length > 0) {
      this.render();
      return;
    }

    this.savingPassword = true;
    this.render();

    try {
      const res = await this.fetch("/api/embed/profile/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ oldPassword, newPassword, confirmPassword }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to change password");
      }

      this.savingPassword = false;
      this.passwordSuccess = true;
      this.render();

      (this.root.querySelector("#oldPassword") as HTMLInputElement).value = "";
      (this.root.querySelector("#newPassword") as HTMLInputElement).value = "";
      (this.root.querySelector("#confirmPassword") as HTMLInputElement).value = "";

      this.emit("passwordChanged");

      if (this.passwordSuccessTimer) clearTimeout(this.passwordSuccessTimer);
      this.passwordSuccessTimer = setTimeout(() => {
        this.passwordSuccess = false;
        this.render();
      }, 3000);
    } catch (err) {
      this.savingPassword = false;
      this.passwordError = err instanceof Error ? err.message : "Failed to change password";
      this.render();
      this.emit("passwordError", { error: this.passwordError });
    }
  }

  private formatPhone(input: HTMLInputElement) {
    let digits = input.value.replace(/\D/g, "");
    if (digits.length > 10) digits = digits.slice(0, 10);
    if (digits.length >= 7) {
      input.value = `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
    } else if (digits.length >= 4) {
      input.value = `${digits.slice(0, 3)}-${digits.slice(3)}`;
    } else {
      input.value = digits;
    }
  }

  private fieldError(field: string): string {
    const err = this.validationErrors[field];
    return err ? `<span class="nw-field-error">${this.esc(err)}</span>` : "";
  }

  private pwError(field: string): string {
    const err = this.passwordErrors[field];
    return err ? `<span class="nw-field-error">${this.esc(err)}</span>` : "";
  }

  private eyeIcon(visible: boolean): string {
    return visible
      ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`
      : `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
  }

  private esc(str: string): string {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  // THE STYLES - all the CSS from getStyles() should be kept identical
  private getStyles(): string {
    return `
      :host {
        all: initial;
        display: block;
        font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
        color: #2D2926;
        font-size: 14px;
        line-height: 1.5;
      }

      *, *::before, *::after { box-sizing: border-box; }

      .nw-profile {
        max-width: 640px;
        margin: 0 auto;
      }

      .nw-photo-section {
        display: flex;
        align-items: center;
        gap: 20px;
        margin-bottom: 24px;
        padding-bottom: 24px;
        border-bottom: 1px solid #E0E0E0;
      }
      .nw-photo-wrap {
        position: relative;
        width: 110px;
        height: 110px;
        flex-shrink: 0;
      }
      .nw-photo-img {
        width: 110px;
        height: 110px;
        border-radius: 50%;
        object-fit: cover;
        display: none;
        border: 3px solid #E0E0E0;
      }
      .nw-photo-img.nw-photo-loaded {
        display: block;
      }
      .nw-photo-placeholder {
        width: 110px;
        height: 110px;
        border-radius: 50%;
        background: #f3f4f6;
        border: 3px solid #E0E0E0;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .nw-photo-placeholder.nw-hidden { display: none; }
      .nw-photo-btn {
        position: absolute;
        bottom: 2px;
        left: 2px;
        width: 32px;
        height: 32px;
        border-radius: 50%;
        background: white;
        border: 2px solid #004C97;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0;
        transition: border-color 0.15s, background 0.15s;
      }
      .nw-photo-btn:hover:not(:disabled) { background: #f3f4f6; }
      .nw-photo-btn:disabled { opacity: 0.65; cursor: not-allowed; }
      .nw-photo-input { display: none; }
      .nw-photo-text { flex: 1; }
      .nw-photo-greeting {
        font-size: 22px;
        font-weight: 800;
        color: #2D2926;
        line-height: 1.3;
      }
      .nw-photo-subtext {
        font-size: 13px;
        color: #474747;
        margin: 8px 0 0 0;
        line-height: 1.5;
      }
      .nw-hidden { display: none !important; }

      .nw-loading {
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 48px 16px;
        color: #9E9E9E;
      }
      .nw-spinner {
        width: 32px;
        height: 32px;
        border: 3px solid #E0E0E0;
        border-top-color: #004C97;
        border-radius: 50%;
        animation: nw-spin 0.8s linear infinite;
        margin-bottom: 12px;
      }
      .nw-spinner-sm {
        display: inline-block;
        width: 14px;
        height: 14px;
        border: 2px solid rgba(255,255,255,0.4);
        border-top-color: white;
        border-radius: 50%;
        animation: nw-spin 0.8s linear infinite;
        vertical-align: middle;
        margin-right: 6px;
      }
      @keyframes nw-spin { to { transform: rotate(360deg); } }

      .nw-error-box {
        text-align: center;
        padding: 32px;
        color: #991b1b;
        background: #fee2e2;
        border-radius: 8px;
      }
      .nw-error-box button { margin-top: 12px; }

      .nw-toast {
        padding: 10px 14px;
        border-radius: 6px;
        font-size: 13px;
        font-weight: 500;
        margin-bottom: 16px;
      }
      .nw-toast-success {
        background: #ecfdf5;
        color: #065f46;
        border: 1px solid #86AD3F;
      }
      .nw-toast-error {
        background: #fef2f2;
        color: #991b1b;
        border: 1px solid #FF6D6A;
      }

      .nw-section {
        border: none;
        padding: 0;
        margin: 0 0 24px 0;
      }
      .nw-section-label {
        display: block;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: #9E9E9E;
        margin-bottom: 12px;
        padding-bottom: 8px;
        border-bottom: 1px solid #E0E0E0;
      }

      .nw-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 14px;
      }
      .nw-grid-single {
        grid-template-columns: 1fr;
      }
      @media (max-width: 640px) {
        .nw-grid { grid-template-columns: 1fr; }
      }
      .nw-field-full { grid-column: 1 / -1; }

      .nw-field label {
        display: block;
        font-size: 12px;
        font-weight: 600;
        color: #474747;
        margin-bottom: 4px;
      }
      .nw-field input[type="text"],
      .nw-field input[type="email"],
      .nw-field input[type="tel"],
      .nw-field input[type="password"],
      .nw-field select {
        width: 100%;
        padding: 8px 10px;
        border: 1px solid #d1d5db;
        border-radius: 6px;
        font-size: 14px;
        font-family: inherit;
        color: #2D2926;
        background: white;
        transition: border-color 0.15s;
      }
      .nw-field input:focus,
      .nw-field select:focus {
        outline: none;
        border-color: #004C97;
        box-shadow: 0 0 0 2px rgba(0, 76, 151, 0.15);
      }
      .nw-field-error {
        display: block;
        font-size: 12px;
        color: #FF6D6A;
        margin-top: 3px;
      }

      .nw-dob-row {
        display: flex;
        gap: 8px;
      }
      .nw-dob-row select { flex: 1; }
      .nw-field-dob { grid-column: 1 / -1; }

      .nw-checkbox-label {
        display: flex !important;
        align-items: flex-start;
        gap: 8px;
        font-weight: 400 !important;
        font-size: 14px !important;
        color: #2D2926 !important;
        cursor: pointer;
      }
      .nw-checkbox-label input[type="checkbox"] {
        width: 16px;
        height: 16px;
        accent-color: #004C97;
        flex-shrink: 0;
        margin-top: 2px;
      }
      .nw-checkbox-hint {
        display: block;
        color: #9E9E9E;
        font-size: 11px;
        margin-top: 2px;
      }
      .nw-comm-prefs {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .nw-comm-header {
        font-size: 12px;
        font-weight: 700;
        color: #474747;
        margin-bottom: 2px;
      }

      .nw-password-wrap {
        position: relative;
      }
      .nw-password-wrap input {
        width: 100%;
        padding: 8px 40px 8px 10px;
        border: 1px solid #d1d5db;
        border-radius: 6px;
        font-size: 14px;
        font-family: inherit;
        color: #2D2926;
        background: white;
        transition: border-color 0.15s;
      }
      .nw-password-wrap input:focus {
        outline: none;
        border-color: #004C97;
        box-shadow: 0 0 0 2px rgba(0, 76, 151, 0.15);
      }
      .nw-eye-btn {
        position: absolute;
        right: 8px;
        top: 50%;
        transform: translateY(-50%);
        background: none;
        border: none;
        cursor: pointer;
        color: #9E9E9E;
        padding: 4px;
        display: flex;
        align-items: center;
      }
      .nw-eye-btn:hover { color: #474747; }

      .nw-actions {
        padding-top: 8px;
        margin-bottom: 24px;
      }
      .nw-btn {
        padding: 10px 24px;
        border: none;
        border-radius: 6px;
        font-size: 14px;
        font-weight: 600;
        font-family: inherit;
        cursor: pointer;
        transition: background 0.15s;
      }
      .nw-btn:disabled {
        opacity: 0.65;
        cursor: not-allowed;
      }
      .nw-btn-primary {
        background: #004C97;
        color: white;
      }
      .nw-btn-primary:hover:not(:disabled) { background: #002855; }
    `;
  }
}

if (!customElements.get("next-profile")) {
  customElements.define("next-profile", ProfileWidget);
}
