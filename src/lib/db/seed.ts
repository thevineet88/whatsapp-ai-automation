import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import "dotenv/config";
import type { Db } from "./client";
import { createDb } from "./client";
import { batches, packages, tenantConfigs, tenants, whatsappAccounts } from "./schema";

type SeedPackageInput = {
  name: string;
  slug: string;
  category: (typeof packages.$inferInsert)["category"];
  durationDays: number;
  durationNights: number;
  highlights: string[];
  advisory: string;
  departurePoint: string;
  travelMode: string;
  returnPoint: string;
  itinerary: { day: number; title: string; description: string }[];
  inclusions: string[];
  exclusions: string[];
  pointsToNote: string[];
  batch: {
    departureDate: string;
    seatsTotal: number;
    startingPricePaise: number;
    lastBookingDate: string;
  };
};

const STANDARD_POINTS_TO_NOTE = [
  "Group conduct and itinerary decisions during the trip are at the sole discretion of the tour manager.",
  "Itinerary is subject to change due to weather, road, or local authority conditions.",
  "Samyati Holidays' liability is limited to the services listed under Inclusions.",
  "Seating in vehicles is allotted by the tour manager and is not guaranteed by booking order.",
  "Personal expenses at stops (meals outside the itinerary, shopping, tips) are borne by the traveller.",
];

const SEED_PACKAGES: SeedPackageInput[] = [
  {
    name: "Kedarnath-Badrinath Yatra",
    slug: "kedarnath-badrinath-yatra",
    category: "spiritual",
    durationDays: 11,
    durationNights: 10,
    highlights: [
      "Darshan at Kedarnath and Badrinath temples",
      "Helicopter option available for Kedarnath",
      "Covers Haridwar, Rishikesh, Guptkashi, and Joshimath",
    ],
    advisory:
      "Involves high-altitude terrain and trekking or pony/palki travel to Kedarnath. Not recommended for travellers with cardiac, respiratory, or mobility conditions without medical clearance.",
    departurePoint: "Mumbai / Pune",
    travelMode: "Train + private coach in the hills",
    returnPoint: "Mumbai / Pune",
    itinerary: [
      { day: 1, title: "Departure", description: "Board train from Mumbai/Pune towards Haridwar." },
      {
        day: 2,
        title: "Arrival at Haridwar",
        description: "Arrive Haridwar, transfer to hotel, evening Ganga Aarti.",
      },
      {
        day: 3,
        title: "Haridwar to Guptkashi",
        description: "Drive to Guptkashi via Rudraprayag.",
      },
      {
        day: 4,
        title: "Kedarnath Darshan",
        description: "Trek or helicopter to Kedarnath, darshan, return to base.",
      },
      {
        day: 5,
        title: "Guptkashi to Badrinath",
        description: "Drive towards Badrinath via Joshimath.",
      },
      {
        day: 6,
        title: "Badrinath Darshan",
        description: "Darshan at Badrinath temple, visit Mana village.",
      },
      { day: 7, title: "Badrinath to Rudraprayag", description: "Drive back towards Rudraprayag." },
      { day: 8, title: "Rudraprayag to Haridwar", description: "Drive to Haridwar, evening free." },
      { day: 9, title: "Haridwar to Rishikesh", description: "Local sightseeing in Rishikesh." },
      { day: 10, title: "Return journey begins", description: "Board return train from Haridwar." },
      { day: 11, title: "Arrival", description: "Arrive Mumbai/Pune, tour concludes." },
    ],
    inclusions: [
      "Train travel (as per itinerary)",
      "Hotel accommodation on double/triple sharing",
      "All meals (breakfast, lunch, dinner)",
      "Private coach for hill travel",
      "Tour manager throughout",
    ],
    exclusions: [
      "Helicopter tickets for Kedarnath (optional, on request)",
      "Pony, palki, or porter charges",
      "Personal expenses and tips",
      "Anything not mentioned under Inclusions",
    ],
    pointsToNote: STANDARD_POINTS_TO_NOTE,
    batch: {
      departureDate: "2026-09-12",
      seatsTotal: 35,
      startingPricePaise: 21_111_00,
      lastBookingDate: "2026-08-25",
    },
  },
  {
    name: "Gokarna-Murudeshwar",
    slug: "gokarna-murudeshwar",
    category: "beach",
    durationDays: 5,
    durationNights: 4,
    highlights: [
      "Om Beach and Kudle Beach at Gokarna",
      "Murudeshwar Shiva statue and temple",
      "Coastal Karnataka sightseeing",
    ],
    advisory:
      "Includes beach and coastal activities with some walking on sand. Swimming is at travellers' own risk and only in designated safe zones.",
    departurePoint: "Mumbai / Pune",
    travelMode: "Overnight train + private coach",
    returnPoint: "Mumbai / Pune",
    itinerary: [
      { day: 1, title: "Departure", description: "Board overnight train towards Gokarna." },
      {
        day: 2,
        title: "Arrival at Gokarna",
        description: "Check in, visit Om Beach and Kudle Beach.",
      },
      {
        day: 3,
        title: "Gokarna to Murudeshwar",
        description: "Drive to Murudeshwar, visit the Shiva statue and temple.",
      },
      {
        day: 4,
        title: "Murudeshwar sightseeing",
        description: "Local sightseeing, free time at the beach.",
      },
      { day: 5, title: "Return journey", description: "Board return train, tour concludes." },
    ],
    inclusions: [
      "Train travel (as per itinerary)",
      "Hotel accommodation on double/triple sharing",
      "Breakfast and dinner",
      "Private coach for local travel",
      "Tour manager throughout",
    ],
    exclusions: [
      "Lunch and any meals not specified",
      "Water sports and optional activities",
      "Personal expenses and tips",
      "Anything not mentioned under Inclusions",
    ],
    pointsToNote: STANDARD_POINTS_TO_NOTE,
    batch: {
      departureDate: "2026-10-02",
      seatsTotal: 40,
      startingPricePaise: 9_999_00,
      lastBookingDate: "2026-09-18",
    },
  },
  {
    name: "Sikkim-Darjeeling",
    slug: "sikkim-darjeeling",
    category: "adventure",
    durationDays: 7,
    durationNights: 6,
    highlights: [
      "Tsomgo Lake and Nathula Pass (permit-based)",
      "Darjeeling tea gardens and toy train",
      "Views of the Kanchenjunga range",
    ],
    advisory:
      "High-altitude destination; Nathula Pass involves travel above 14,000 ft and requires an Inner Line Permit. Altitude sickness is a real risk; travellers with cardiac, respiratory, or blood pressure conditions should consult a doctor before booking.",
    departurePoint: "Mumbai / Pune",
    travelMode: "Flight to Bagdogra + private coach in the hills",
    returnPoint: "Mumbai / Pune",
    itinerary: [
      { day: 1, title: "Arrival at Bagdogra", description: "Fly into Bagdogra, drive to Gangtok." },
      {
        day: 2,
        title: "Gangtok local sightseeing",
        description: "Visit monasteries and local viewpoints.",
      },
      {
        day: 3,
        title: "Tsomgo Lake and Nathula Pass",
        description: "Permit-based excursion, weather permitting.",
      },
      { day: 4, title: "Gangtok to Darjeeling", description: "Drive to Darjeeling via Kalimpong." },
      {
        day: 5,
        title: "Darjeeling sightseeing",
        description: "Tiger Hill sunrise, tea garden visit, toy train ride.",
      },
      { day: 6, title: "Darjeeling to Bagdogra", description: "Drive to Bagdogra, evening free." },
      { day: 7, title: "Departure", description: "Fly out from Bagdogra, tour concludes." },
    ],
    inclusions: [
      "Return flights to/from Bagdogra (as per itinerary)",
      "Hotel accommodation on double/triple sharing",
      "All meals (breakfast, lunch, dinner)",
      "Private coach for hill travel",
      "Permit assistance for Nathula Pass",
      "Tour manager throughout",
    ],
    exclusions: [
      "Nathula Pass permit fee (paid at cost)",
      "Personal expenses and tips",
      "Any activity not part of the fixed itinerary",
      "Anything not mentioned under Inclusions",
    ],
    pointsToNote: STANDARD_POINTS_TO_NOTE,
    batch: {
      departureDate: "2026-10-20",
      seatsTotal: 25,
      startingPricePaise: 27_777_00,
      lastBookingDate: "2026-10-01",
    },
  },
];

export async function seedSamyati(db: Db) {
  const [tenant] = await db
    .insert(tenants)
    .values({ name: "Samyati Holidays", slug: "samyati-holidays" })
    .returning();

  await db.insert(whatsappAccounts).values({
    tenantId: tenant.id,
    phoneNumberId: "samyati-dev-phone-number-id",
    displayPhoneNumber: "+91 90760 68549",
  });

  await db.insert(tenantConfigs).values({
    tenantId: tenant.id,
    version: 1,
    escalationContacts: [
      { name: "Rohit", phone: "+91 90760 68549" },
      { name: "Shrutika", phone: "+91 90760 68549" },
      { name: "Tejashree", phone: "+91 90760 68549" },
    ],
    config: {},
    isActive: true,
  });

  for (const seedPackage of SEED_PACKAGES) {
    const [insertedPackage] = await db
      .insert(packages)
      .values({
        tenantId: tenant.id,
        name: seedPackage.name,
        slug: seedPackage.slug,
        category: seedPackage.category,
        durationDays: seedPackage.durationDays,
        durationNights: seedPackage.durationNights,
        highlights: seedPackage.highlights,
        advisory: seedPackage.advisory,
        departurePoint: seedPackage.departurePoint,
        travelMode: seedPackage.travelMode,
        returnPoint: seedPackage.returnPoint,
        itinerary: seedPackage.itinerary,
        inclusions: seedPackage.inclusions,
        exclusions: seedPackage.exclusions,
        pointsToNote: seedPackage.pointsToNote,
      })
      .returning();

    await db.insert(batches).values({
      tenantId: tenant.id,
      packageId: insertedPackage.id,
      departureDate: seedPackage.batch.departureDate,
      seatsTotal: seedPackage.batch.seatsTotal,
      seatsAvailable: seedPackage.batch.seatsTotal,
      startingPricePaise: seedPackage.batch.startingPricePaise,
      lastBookingDate: seedPackage.batch.lastBookingDate,
    });
  }

  return tenant;
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("Missing required environment variable: DATABASE_URL");
  }

  const db = createDb(connectionString);
  const tenant = await seedSamyati(db);
  console.log(`Seeded tenant ${tenant.slug} with ${SEED_PACKAGES.length} packages.`);
}

const isMainModule =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === realpathSync(process.argv[1]);

if (isMainModule) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
