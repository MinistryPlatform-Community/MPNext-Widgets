import { MPHelper } from "@/lib/providers/ministry-platform";
import type { CalendarEventData } from "@mpnext/types";

interface EventRecord {
  Event_ID: number;
  Event_Title: string;
  Description: string | null;
  Event_Start_Date: string;
  Event_End_Date: string;
  Location_ID: number | null;
}

interface LocationRecord {
  Location_ID: number;
  Location_Name: string;
  Address_ID: number | null;
}

interface AddressRecord {
  Address_ID: number;
  Address_Line_1: string;
  City: string | null;
  "State/Region": string | null;
  Postal_Code: string | null;
}

export class AddToCalendarService {
  private static instance: AddToCalendarService;
  private mp: MPHelper | null = null;

  private constructor() {
    this.initialize();
  }

  public static async getInstance(): Promise<AddToCalendarService> {
    if (!AddToCalendarService.instance) {
      AddToCalendarService.instance = new AddToCalendarService();
      await AddToCalendarService.instance.initialize();
    }
    return AddToCalendarService.instance;
  }

  private async initialize(): Promise<void> {
    this.mp = new MPHelper();
  }

  /**
   * Fetch event data suitable for rendering an add-to-calendar button.
   * Resolves Location and Address in sequential steps when IDs are present.
   */
  public async getEventForCalendar(eventId: number): Promise<CalendarEventData | null> {
    const events = await this.mp!.getTableRecords<EventRecord>({
      table: "Events",
      select: "Event_ID,Event_Title,Description,Event_Start_Date,Event_End_Date,Location_ID",
      filter: `Event_ID = ${eventId}`,
      top: 1,
    });

    const event = events[0];
    if (!event) return null;

    // Default location/address values
    let locationName: string | null = null;
    let addressLine1: string | null = null;
    let city: string | null = null;
    let state: string | null = null;
    let postalCode: string | null = null;

    // Resolve Location if present
    if (event.Location_ID) {
      const locations = await this.mp!.getTableRecords<LocationRecord>({
        table: "Locations",
        select: "Location_ID,Location_Name,Address_ID",
        filter: `Location_ID = ${event.Location_ID}`,
        top: 1,
      });

      const location = locations[0];
      if (location) {
        locationName = location.Location_Name;

        // Resolve Address if present
        if (location.Address_ID) {
          const addresses = await this.mp!.getTableRecords<AddressRecord>({
            table: "Addresses",
            select: "Address_ID,Address_Line_1,City,State/Region,Postal_Code",
            filter: `Address_ID = ${location.Address_ID}`,
            top: 1,
          });

          const address = addresses[0];
          if (address) {
            addressLine1 = address.Address_Line_1 || null;
            city = address.City || null;
            state = address["State/Region"] || null;
            postalCode = address.Postal_Code || null;
          }
        }
      }
    }

    return {
      Event_ID: event.Event_ID,
      Event_Title: event.Event_Title,
      Description: event.Description,
      Event_Start_Date: event.Event_Start_Date,
      Event_End_Date: event.Event_End_Date,
      Location_Name: locationName,
      Address_Line_1: addressLine1,
      City: city,
      State: state,
      Postal_Code: postalCode,
    };
  }
}
