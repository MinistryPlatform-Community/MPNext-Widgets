import { MPHelper } from "@/lib/providers/ministry-platform";
import type { SubscriptionItem } from "@mpnext/types";

interface PublicationRow {
  Publication_ID: number;
  Title: string;
  Description: string | null;
  Online_Sort_Order: number | null;
}

interface ContactPublicationRow {
  Contact_Publication_ID: number;
  Publication_ID: number;
  Unsubscribed: boolean;
}

export class SubscriptionService {
  private static instance: SubscriptionService;
  private mp: MPHelper | null = null;

  private constructor() {
    this.initialize();
  }

  public static async getInstance(): Promise<SubscriptionService> {
    if (!SubscriptionService.instance) {
      SubscriptionService.instance = new SubscriptionService();
      await SubscriptionService.instance.initialize();
    }
    return SubscriptionService.instance;
  }

  private async initialize(): Promise<void> {
    this.mp = new MPHelper();
  }

  /**
   * Resolve User_GUID → Contact_ID
   */
  public async getContactIdByUserGuid(userGuid: string): Promise<number | null> {
    const users = await this.mp!.getTableRecords<{ User_ID: number; Contact_ID: number }>({
      table: "dp_Users",
      filter: `User_GUID = '${userGuid}'`,
      select: "User_ID,Contact_ID",
      top: 1,
    });
    return users.length > 0 ? users[0].Contact_ID : null;
  }

  /**
   * Get all available publications for given congregations, merged with the
   * contact's subscription state. Sorted by Online_Sort_Order then Title.
   */
  public async getSubscriptions(
    contactId: number,
    congregationIds: number[] = [1, 10]
  ): Promise<SubscriptionItem[]> {
    const congFilter = congregationIds
      .map((id) => `Congregation_ID = ${id}`)
      .join(" OR ");

    const [publications, contactPubs] = await Promise.all([
      this.mp!.getTableRecords<PublicationRow>({
        table: "dp_Publications",
        filter: `(Available_Online = 1 OR Available_Online IS NULL) AND (${congFilter})`,
        select: "Publication_ID,Title,Description,Online_Sort_Order",
      }),
      this.mp!.getTableRecords<ContactPublicationRow>({
        table: "dp_Contact_Publications",
        filter: `Contact_ID = ${contactId}`,
        select: "Contact_Publication_ID,Publication_ID,Unsubscribed",
      }),
    ]);

    // Build lookup: Publication_ID → subscription state
    const subMap = new Map<number, ContactPublicationRow>();
    for (const cp of contactPubs) {
      subMap.set(cp.Publication_ID, cp);
    }

    // Merge and determine subscribed state
    const items: SubscriptionItem[] = publications.map((pub) => {
      const cp = subMap.get(pub.Publication_ID);
      // Subscribed = has a Contact_Publication record AND Unsubscribed is false
      const subscribed = cp ? !cp.Unsubscribed : false;

      return {
        Publication_ID: pub.Publication_ID,
        Title: pub.Title,
        Description: pub.Description,
        Online_Sort_Order: pub.Online_Sort_Order,
        subscribed,
      };
    });

    // Sort by Online_Sort_Order (nulls last), then alphabetically by Title
    items.sort((a, b) => {
      const orderA = a.Online_Sort_Order ?? Number.MAX_SAFE_INTEGER;
      const orderB = b.Online_Sort_Order ?? Number.MAX_SAFE_INTEGER;
      if (orderA !== orderB) return orderA - orderB;
      return a.Title.localeCompare(b.Title);
    });

    return items;
  }

  /**
   * Update a contact's subscriptions. Takes the full list of Publication_IDs
   * the user wants to be subscribed to. Creates/updates dp_Contact_Publications
   * records accordingly.
   */
  public async updateSubscriptions(
    contactId: number,
    subscribedIds: number[],
    congregationIds: number[] = [1, 10]
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const congFilter = congregationIds
        .map((id) => `Congregation_ID = ${id}`)
        .join(" OR ");

      // Get all available publications for these congregations
      const publications = await this.mp!.getTableRecords<PublicationRow>({
        table: "dp_Publications",
        filter: `(Available_Online = 1 OR Available_Online IS NULL) AND (${congFilter})`,
        select: "Publication_ID",
      });
      const validPubIds = new Set(publications.map((p) => p.Publication_ID));

      // Get the contact's existing subscription records
      const existing = await this.mp!.getTableRecords<ContactPublicationRow>({
        table: "dp_Contact_Publications",
        filter: `Contact_ID = ${contactId}`,
        select: "Contact_Publication_ID,Publication_ID,Unsubscribed",
      });

      const existingMap = new Map<number, ContactPublicationRow>();
      for (const cp of existing) {
        existingMap.set(cp.Publication_ID, cp);
      }

      const subscribedSet = new Set(subscribedIds);
      const toCreate: Record<string, unknown>[] = [];
      const toUpdate: Record<string, unknown>[] = [];

      for (const pubId of validPubIds) {
        const wantSubscribed = subscribedSet.has(pubId);
        const existingRecord = existingMap.get(pubId);

        if (existingRecord) {
          // Record exists — update Unsubscribed flag if it changed
          const currentlySubscribed = !existingRecord.Unsubscribed;
          if (wantSubscribed !== currentlySubscribed) {
            toUpdate.push({
              Contact_Publication_ID: existingRecord.Contact_Publication_ID,
              Unsubscribed: !wantSubscribed,
            });
          }
        } else if (wantSubscribed) {
          // No record yet and user wants to subscribe — create one
          toCreate.push({
            Contact_ID: contactId,
            Publication_ID: pubId,
            Unsubscribed: false,
          });
        }
        // If no record and not subscribing, do nothing
      }

      // Batch updates and creates
      if (toUpdate.length > 0) {
        await this.mp!.updateTableRecords(
          "dp_Contact_Publications",
          toUpdate
        );
      }
      if (toCreate.length > 0) {
        await this.mp!.createTableRecords(
          "dp_Contact_Publications",
          toCreate
        );
      }

      return { success: true };
    } catch (error) {
      console.error("Error updating subscriptions:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to update subscriptions",
      };
    }
  }
}
