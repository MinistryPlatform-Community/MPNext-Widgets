import { MPHelper } from "@/lib/providers/ministry-platform";

/**
 * Reads values from MP's `dp_Configuration_Settings` table. Shared by widgets
 * that need tenant-level config (e.g. the Google Maps key used for address
 * autocomplete in next-my-household and next-custom-form).
 */
export class ConfigSettingsService {
  private static instance: ConfigSettingsService;
  private mp: MPHelper | null = null;

  private constructor() {
    this.initialize();
  }

  public static async getInstance(): Promise<ConfigSettingsService> {
    if (!ConfigSettingsService.instance) {
      ConfigSettingsService.instance = new ConfigSettingsService();
      await ConfigSettingsService.instance.initialize();
    }
    return ConfigSettingsService.instance;
  }

  private async initialize(): Promise<void> {
    this.mp = new MPHelper();
  }

  /**
   * Read a single configuration setting value. Returns the trimmed value, or
   * `null` when the setting is missing/empty or the lookup fails (graceful).
   */
  public async getSetting(
    applicationCode: string,
    keyName: string,
  ): Promise<string | null> {
    try {
      const rows = await this.mp!.getTableRecords<{ Value: string | null }>({
        table: "dp_Configuration_Settings",
        select: "Value",
        filter: `Application_Code = '${applicationCode.replace(/'/g, "''")}' AND Key_Name = '${keyName.replace(/'/g, "''")}'`,
        top: 1,
      });
      const value = rows[0]?.Value?.trim();
      return value ? value : null;
    } catch (err) {
      console.warn(
        `ConfigSettingsService: Failed to fetch ${applicationCode}/${keyName}:`,
        err,
      );
      return null;
    }
  }

  /** The tenant's Google Maps JavaScript API key, or `null` if unset. */
  public async getGoogleMapsApiKey(): Promise<string | null> {
    return this.getSetting("COMMON", "GoogleMapsAPIKey");
  }
}
