// Seed knowledge base content for step 8. Covers the two content types from
// CLAUDE.md's KB priority list that aren't already structured, tool-served
// data: (4) best season and weather notes, and (8) permits, ID requirements,
// connectivity, and altitude notes. Everything here is factual (temperature
// ranges, permit rules, network coverage) and deliberately stops short of
// any fitness or medical assessment; those questions escalate per the
// hardcoded trigger, never get an answer from this content.
//
// Keyed by package slug so the ingestion script can resolve it to a
// package_id after seeding. `source` must stay stable across edits so
// re-ingesting replaces the old chunks instead of duplicating them.

export type KnowledgeContentEntry = {
  packageSlug: string;
  source: string;
  content: string;
};

export const PACKAGE_KNOWLEDGE_CONTENT: KnowledgeContentEntry[] = [
  {
    packageSlug: "kedarnath-badrinath-yatra",
    source: "best_season",
    content: `The Kedarnath-Badrinath Yatra runs during the temple opening season, which is typically late April or early May through early November, when the shrines close for winter.

May and June are the most popular months, with clear weather and daytime temperatures around 10-20°C in Kedarnath and slightly warmer in Badrinath. Evenings are cold; warm layers are needed even in peak summer.

July to early September is the monsoon window. Heavy rain is common in the hills during this period and can cause road delays or itinerary changes at short notice. Batches still run in this window but travellers should expect possible weather-driven changes.

September to early November is the second popular window, with cooler, generally drier weather and daytime temperatures around 5-15°C, dropping close to freezing at night as the season closes.`,
  },
  {
    packageSlug: "kedarnath-badrinath-yatra",
    source: "permits_and_connectivity",
    content: `No special inner-line permit is required for Indian nationals visiting Kedarnath or Badrinath; a valid government photo ID is sufficient.

Kedarnath temple itself is reached by a roughly 16-18 km trek or pony/palki/helicopter from Gaurikund or Sonprayag; the last stretch has no vehicle access. Badrinath is reachable directly by road.

Mobile network coverage (voice and data) is patchy beyond Guptkashi and largely unavailable on the Kedarnath trek route itself; connectivity resumes at Kedarnath base and improves again near Badrinath town.

Kedarnath sits at roughly 3,583 metres (11,755 ft) elevation; Badrinath at roughly 3,133 metres (10,279 ft). Both are high-altitude locations.`,
  },
  {
    packageSlug: "gokarna-murudeshwar",
    source: "best_season",
    content: `Gokarna and Murudeshwar are on the Karnataka coast, so the best season runs October through March, when the weather is dry and pleasant with daytime temperatures around 24-32°C.

December and January are the coolest and most popular months. April to June turns hot and humid ahead of the monsoon. The southwest monsoon (roughly June to September) brings heavy rain and rough seas to this coast, so beach and water activities are limited or unavailable during that window; batches are not typically scheduled in peak monsoon months.`,
  },
  {
    packageSlug: "gokarna-murudeshwar",
    source: "permits_and_connectivity",
    content: `No special permit is required for this route; a valid government photo ID is sufficient for hotel check-in.

Both Gokarna and Murudeshwar are coastal towns with good mobile network coverage on the main beaches and town areas. This is a low-altitude coastal itinerary with no altitude-related considerations.`,
  },
  {
    packageSlug: "sikkim-darjeeling",
    source: "best_season",
    content: `Sikkim and Darjeeling have two main travel windows: March to June (spring into early summer) and October to mid-December (post-monsoon autumn).

March to June brings clear mountain views and blooming rhododendrons, with daytime temperatures around 12-22°C in Gangtok and Darjeeling, cooler at Tsomgo Lake and Nathula Pass, which can still see residual snow into early summer.

October to mid-December offers the clearest skies for Kanchenjunga views, with daytime temperatures around 8-18°C, dropping below freezing at higher points like Nathula Pass.

The monsoon (roughly June to September) brings heavy rain, landslide risk, and frequent road closures in the hills, and access to Nathula Pass and Tsomgo Lake is often suspended in winter (January-February) due to heavy snow. Batches are scheduled around these constraints.`,
  },
  {
    packageSlug: "sikkim-darjeeling",
    source: "permits_and_connectivity",
    content: `An Inner Line Permit (ILP) is required for Indian nationals to visit Tsomgo Lake and Nathula Pass, since Nathula sits on the India-China border. The tour arranges this permit; travellers need a valid government photo ID and passport-size photos to apply, and the permit can be denied or the pass closed by local authorities at short notice due to weather or border conditions, which can mean skipping that excursion.

Foreign nationals need a separate Protected Area Permit for parts of Sikkim and are generally not permitted at Nathula Pass; foreign nationals should flag this before booking.

Mobile connectivity is reliable in Gangtok and Darjeeling town but is unreliable or absent at Tsomgo Lake and Nathula Pass.

Nathula Pass sits at roughly 4,310 metres (14,140 ft), Tsomgo Lake at roughly 3,753 metres (12,313 ft). Both are high-altitude points reached in a single day trip from Gangtok, which is itself at roughly 1,650 metres (5,410 ft).`,
  },
];
