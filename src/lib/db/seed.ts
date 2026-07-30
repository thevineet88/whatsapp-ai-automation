import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import "dotenv/config";
import { DEFAULT_HOLDING_REPLY } from "@/lib/core/config";
import { type PackageCategory, STANDARD_POINTS_TO_NOTE } from "@/lib/core/package";
import type { Db } from "./client";
import { createDb } from "./client";
import {
  batchPriceVariants,
  batches,
  cancellationRules,
  packages,
  paymentInstallments,
  tenantConfigs,
  tenants,
  whatsappAccounts,
} from "./schema";

type SeedPackageInput = {
  name: string;
  slug: string;
  category: PackageCategory[];
  durationDays: number;
  durationNights: number;
  highlights: string[];
  advisory: string;
  flightInformation?: string;
  departurePoint: string;
  travelMode: string;
  returnPoint: string;
  itinerary: { day: number; title: string; description: string; date?: string; meals?: string }[];
  inclusions: string[];
  exclusions: string[];
  pointsToNote: string[];
  batch: {
    departureDate: string;
    seatsTotal: number;
    startingPricePaise: number;
    lastBookingDate: string | null;
  };
  priceVariants: { occupancyType: string; pricePaise: number }[];
  paymentInstallments: {
    sequence: number;
    label: string;
    amountPaise: number;
    dueBy: string;
  }[];
  cancellationPolicy: { sequence: number; cutoff: string; deduction: string }[];
};

// Sourced from samyatiholidays.com's own package data (packages-data.js).
// Seats-per-batch isn't published on the site, so SEATS_TOTAL_DEFAULT is an
// assumed group-coach size, not real capacity data; update per batch in the
// admin panel once real seat counts are known.
const SEATS_TOTAL_DEFAULT = 30;

const SEED_PACKAGES: SeedPackageInput[] = [
  {
    name: "Kerala Trip",
    slug: "kerala",
    category: ["nature"],
    durationDays: 8,
    durationNights: 7,
    highlights: [
      "Munnar Tea Gardens",
      "Alleppey Houseboat Stay",
      "Periyar Wildlife Sanctuary",
      "Thekkady Spice Market",
      "Kerala Backwaters",
    ],
    advisory: "",
    departurePoint: "Panvel — 11:00 PM, 02 Oct 2026",
    travelMode: "NZM-ERS SF Express (22656)",
    returnPoint: "Reach Mumbai by 05:00 PM, 09 Oct 2026",
    itinerary: [
      {
        day: 1,
        date: "02 Oct (Friday)",
        title: "Board Train at Panvel",
        description:
          "Board the NZM-ERS SF Express (22656) at Panvel at 11:00 PM. Settle in and get comfortable for the overnight train journey to Kerala.",
        meals: "No Meals",
      },
      {
        day: 2,
        date: "03 Oct (Saturday)",
        title: "Train Journey",
        description:
          "Enjoy the scenic train journey crossing the Western Ghats. Relax, bond with fellow travellers and look forward to Kerala.",
        meals: "No Meals (train food at own cost)",
      },
      {
        day: 3,
        date: "04 Oct (Sunday)",
        title: "Arrive Ernakulam → Munnar",
        description:
          "Arrive Ernakulam at 3:00 AM. After freshening up, depart for Munnar. En route visit Cheeyapara Waterfalls and Valara Waterfalls. Check in to hotel. Dinner and overnight stay.",
        meals: "Dinner",
      },
      {
        day: 4,
        date: "05 Oct (Monday)",
        title: "Munnar Sightseeing",
        description:
          "Full-day sightseeing in Munnar — Mattupetty Dam, Echo Point, Blossom Hydel Park, and Tea Museum. Return to hotel. Dinner and overnight stay.",
        meals: "Breakfast & Dinner",
      },
      {
        day: 5,
        date: "06 Oct (Tuesday)",
        title: "Thekkady Sightseeing",
        description:
          "Early morning breakfast and check out. Visit Periyar Wildlife Sanctuary (boating at own cost), optional Elephant Ride (own cost), and Shopping at Local Market. Return to hotel. Dinner and overnight stay.",
        meals: "Breakfast & Dinner",
      },
      {
        day: 6,
        date: "07 Oct (Wednesday)",
        title: "Alleppey Houseboat",
        description:
          "Early morning breakfast and check out. Check in at Private Houseboat. Leisure time on the houseboat, Lunch on Houseboat. Spend a relaxed evening cruising the backwaters. Dinner and overnight stay on Houseboat.",
        meals: "Breakfast & Dinner",
      },
      {
        day: 7,
        date: "08 Oct (Thursday)",
        title: "Departure for Mumbai",
        description:
          "Early morning breakfast. Check out from Houseboat. Catch the return train from Alleppey at 10:30 AM (for Mumbaikars). Overnight train journey back home.",
        meals: "Breakfast",
      },
      {
        day: 8,
        date: "09 Oct (Sunday)",
        title: "Reach Mumbai",
        description: "Reach Mumbai by 05:00 PM. Return Home with Sweet Memories!",
        meals: "No Meals",
      },
    ],
    inclusions: [
      "Both way SL Train Tickets (3AC upgrade available)",
      "AC Tempo Traveller / Bus for local sightseeing",
      "Accommodation in 3★ Hotel (3/4 Sharing)",
      "Houseboat Stay (3-sharing compulsory)",
      "5 Breakfasts & 4 Dinners",
      "1L Mineral Water on sightseeing days",
      "First Aid",
      "Tour Manager",
    ],
    exclusions: [
      "5% GST",
      "Train Food",
      "Lunch",
      "Boating / Activities (at own cost)",
      "Any damage to hotel room",
      "Anything not mentioned in inclusions",
    ],
    pointsToNote: STANDARD_POINTS_TO_NOTE,
    batch: {
      departureDate: "2026-10-02",
      seatsTotal: SEATS_TOTAL_DEFAULT,
      startingPricePaise: 15_555_00,
      lastBookingDate: "2026-07-25",
    },
    priceVariants: [
      { occupancyType: "Sleeper Class", pricePaise: 15_555_00 },
      { occupancyType: "3AC", pricePaise: 17_999_00 },
    ],
    paymentInstallments: [
      {
        sequence: 1,
        label: "1st Installment (Non-Refundable)",
        amountPaise: 8_555_00,
        dueBy: "25 July 2026",
      },
      { sequence: 2, label: "2nd Installment", amountPaise: 7_000_00, dueBy: "20 Aug 2026" },
    ],
    cancellationPolicy: [
      { sequence: 1, cutoff: "On/Before 05 Aug 2026", deduction: "50%" },
      { sequence: 2, cutoff: "On/Before 25 Aug 2026", deduction: "90%" },
      { sequence: 3, cutoff: "After that", deduction: "No Refund" },
    ],
  },
  {
    name: "Gokarna-Murudeshwar",
    slug: "gokarna-murudeshwar",
    category: ["spiritual", "beach"],
    durationDays: 5,
    durationNights: 4,
    highlights: [
      "Murudeshwar Shiva Statue (World's 2nd Tallest)",
      "Yana Caves",
      "Gokarna Beach",
      "Apsarkonda Waterfall",
      "Honnavar Backwater Boating",
    ],
    advisory: "",
    departurePoint: "LTT (Mumbai) — 2:00 PM, 26 Aug 2026",
    travelMode: "Matsyagandha Express (12619)",
    returnPoint: "Matsyagandha Express (12620)",
    itinerary: [
      {
        day: 1,
        date: "26 Aug (Wednesday)",
        title: "Board Train at LTT Mumbai",
        description:
          "Board Matsyagandha Express (12619) at LTT at 2:00 PM. Overnight journey to Murudeshwar.",
        meals: "No Meals",
      },
      {
        day: 2,
        date: "27 Aug (Thursday)",
        title: "Arrive Murudeshwar → Gokarna",
        description:
          "Arrive Murudeshwar at 5:00 AM. After freshening up, visit Apsarkonda Waterfall, Mirjan Fort, Mahabaleshwara Temple, and Gokarna Beach. Check in and overnight stay.",
        meals: "Breakfast & Dinner",
      },
      {
        day: 3,
        date: "28 Aug (Friday)",
        title: "Murudeshwar Temple & Backwaters",
        description:
          "Visit the iconic Murudeshwar Temple with the world's 2nd tallest Shiva statue. Enjoy Honnavar Backwater Boating. Spend the evening at the beach watching the sunset. Dinner and overnight stay.",
        meals: "Breakfast & Dinner",
      },
      {
        day: 4,
        date: "29 Aug (Saturday)",
        title: "Yana Caves & Vibhuti Waterfall",
        description:
          "Morning visit to the mystical Yana Caves — unique black crystalline limestone rock formations. Visit Vibhuti Waterfall. Board the return train at 4:00 PM.",
        meals: "Breakfast",
      },
      {
        day: 5,
        date: "30 Aug (Sunday)",
        title: "Arrive Mumbai",
        description: "Arrive Mumbai in the morning. Return Home with Sweet Memories!",
        meals: "No Meals",
      },
    ],
    inclusions: [
      "Both way Train Tickets",
      "Local Travelling",
      "Accommodation",
      "Breakfast & Dinner",
      "Mineral Water",
      "Entry Fees",
      "First Aid",
      "Tour Buddy",
    ],
    exclusions: ["5% GST", "Lunch", "Personal expenses", "Anything not mentioned in inclusions"],
    pointsToNote: STANDARD_POINTS_TO_NOTE,
    batch: {
      departureDate: "2026-08-26",
      seatsTotal: SEATS_TOTAL_DEFAULT,
      startingPricePaise: 9_999_00,
      lastBookingDate: null,
    },
    priceVariants: [],
    paymentInstallments: [],
    cancellationPolicy: [],
  },
  {
    name: "Kedarnath-Badrinath Yatra",
    slug: "kedarnath-badrinath-yatra",
    category: ["spiritual"],
    durationDays: 11,
    durationNights: 10,
    highlights: [
      "Kedarnath Temple (3,583m altitude)",
      "21km Trek to Kedarnath",
      "Badrinath Dham",
      "Ganga Aarti at Haridwar",
      "River Adventure at Rishikesh",
    ],
    advisory: "",
    departurePoint: "Bandra Terminus — 11:00 PM, 26 Sep 2026",
    travelMode: "Bandra Haridwar Express (19019)",
    returnPoint: "Reach Mumbai at 08:00 AM, 06 Oct 2026 (Punjab Mail 12138)",
    itinerary: [
      {
        day: 1,
        date: "26 Sep (Saturday)",
        title: "Board Train at Bandra",
        description:
          "Board Bandra Haridwar Express (19019) at Bandra Terminus at 11:00 PM. Overnight journey to Haridwar.",
        meals: "No Meals",
      },
      {
        day: 2,
        date: "27 Sep (Sunday)",
        title: "Train Journey",
        description:
          "Continue train journey to Haridwar. Relax and prepare for the spiritual journey ahead.",
        meals: "No Meals (train food at own cost)",
      },
      {
        day: 3,
        date: "28 Sep (Monday)",
        title: "Haridwar Sightseeing",
        description:
          "Arrive Haridwar at 7:45 AM. Take a holy dip at Har-ki-Pauri. Sightseeing in Haridwar. Witness the mesmerising Ganga Aarti in the evening. Check in and overnight stay.",
        meals: "Breakfast & Dinner",
      },
      {
        day: 4,
        date: "29 Sep (Tuesday)",
        title: "Haridwar → Sonprayag",
        description:
          "Early morning check out at 5:00 AM. Start the 12-hour bus journey to Sonprayag. En route visit Devprayag — the sacred confluence of Alaknanda and Bhagirathi rivers. Dinner and overnight stay in Sonprayag.",
        meals: "Breakfast & Dinner",
      },
      {
        day: 5,
        date: "30 Sep (Wednesday)",
        title: "Sonprayag → Kedarnath Trek",
        description:
          "Check out at 4:00 AM. Local Jeep to Gauri-Kund (base of trek). Begin the 21km trek to Kedarnath on foot. Alternatives: Horse/Helicopter/Doli at own cost. Dinner and overnight stay near Kedarnath Temple.",
        meals: "Dinner",
      },
      {
        day: 6,
        date: "01 Oct (Thursday)",
        title: "Kedarnath Darshan → Sonprayag",
        description:
          "Early morning darshan at Kedarnath Temple & Bhairavnath Temple (4:00–7:00 AM). After breakfast, begin the 21km descent to Gauri-Kund. Return to Sonprayag by Jeep. Dinner and overnight stay.",
        meals: "Breakfast & Dinner",
      },
      {
        day: 7,
        date: "02 Oct (Friday)",
        title: "Sonprayag → Badrinath",
        description:
          "Check out at 5:00 AM. 10-hour bus journey to Badrinath. Visit Shri Badrinath Temple. Dinner at nearby hotel. Overnight stay in Joshimath.",
        meals: "Breakfast & Dinner",
      },
      {
        day: 8,
        date: "03 Oct (Saturday)",
        title: "Badrinath → Rishikesh",
        description:
          "Check out at 5:00 AM. 10-hour journey to Rishikesh. Check in at hotel. Dinner and overnight stay in Rishikesh.",
        meals: "Breakfast & Dinner",
      },
      {
        day: 9,
        date: "04 Oct (Sunday)",
        title: "Rishikesh Sightseeing & Depart",
        description:
          "Check out at 9:00 AM. Adventure activities at Rishikesh (River Rafting etc. at own cost). Sightseeing in Rishikesh. Enroute dinner. Board overnight bus/train towards Delhi.",
        meals: "Breakfast & Dinner",
      },
      {
        day: 10,
        date: "05 Oct (Monday)",
        title: "Delhi → Board Return Train",
        description:
          "Arrive Delhi at 4:00 AM. Board Punjab Mail (12138) for Mumbai. Rest in train.",
        meals: "No Meals",
      },
      {
        day: 11,
        date: "06 Oct (Tuesday)",
        title: "Reach Mumbai",
        description: "Reach Mumbai at 8:00 AM. Return Home with Sweet Memories!",
        meals: "No Meals",
      },
    ],
    inclusions: [
      "Mumbai to Mumbai SL Train Tickets (3AC upgrade available)",
      "Non-AC Tempo Traveller for local sightseeing",
      "Deluxe Hotels (3-4 Sharing)",
      "6-7 Sharing rooms near Kedarnath Temple",
      "Breakfast & Dinner",
      "Entry Fees",
      "Sonprayag to Sonprayag Jeep expense",
      "First Aid",
      "Tour Manager (Haridwar to Delhi)",
    ],
    exclusions: [
      "5% GST",
      "Meals during train journey",
      "All day Lunch",
      "Day 5 Breakfast",
      "Mineral water",
      "Boating / Ride Charges",
      "Personal expenses",
      "Anything not mentioned in inclusions",
    ],
    pointsToNote: STANDARD_POINTS_TO_NOTE,
    batch: {
      departureDate: "2026-09-26",
      seatsTotal: SEATS_TOTAL_DEFAULT,
      startingPricePaise: 21_111_00,
      lastBookingDate: "2026-05-10",
    },
    priceVariants: [
      { occupancyType: "Sleeper Class", pricePaise: 21_111_00 },
      { occupancyType: "3AC", pricePaise: 23_777_00 },
    ],
    paymentInstallments: [
      {
        sequence: 1,
        label: "1st Installment (Non-Refundable)",
        amountPaise: 7_111_00,
        dueBy: "10 May 2026",
      },
      { sequence: 2, label: "2nd Installment", amountPaise: 7_000_00, dueBy: "30 June 2026" },
      { sequence: 3, label: "3rd Installment", amountPaise: 7_000_00, dueBy: "10 Sep 2026" },
    ],
    cancellationPolicy: [
      {
        sequence: 1,
        cutoff: "45+ days before departure",
        deduction: "Railway & hotel cancellation policies",
      },
      { sequence: 2, cutoff: "44–30 days before departure", deduction: "40%" },
      { sequence: 3, cutoff: "29–8 days before departure", deduction: "80%" },
      { sequence: 4, cutoff: "After that", deduction: "No Refund" },
    ],
  },
  {
    name: "Rameshwaram Trip",
    slug: "rameshwaram",
    category: ["spiritual"],
    durationDays: 8,
    durationNights: 7,
    highlights: [
      "Ramanathaswamy Temple — Char Dham",
      "Meenakshi Amman Temple Madurai",
      "Dhanushkodi Beach",
      "Kanyakumari Sunrise/Sunset",
      "Vivekananda Rock Memorial",
    ],
    advisory: "",
    departurePoint: "LTT Mumbai — 8:00 PM, 28 Oct | Pune — 11:30 PM, 28 Oct 2026",
    travelMode: "Nagarcoil Express (16339)",
    returnPoint: "Netravati Exp (16346) for Mumbai | Cape Pune Exp (16382) for Pune",
    itinerary: [
      {
        day: 1,
        date: "28 Oct (Wednesday)",
        title: "Board Train",
        description:
          "Board Nagarcoil Express (16339) at LTT Mumbai at 8:00 PM or Pune at 11:30 PM. Overnight train journey to South India.",
        meals: "No Meals",
      },
      {
        day: 2,
        date: "29 Oct (Thursday)",
        title: "Train Journey",
        description: "Continue train journey. Relax and prepare for your South India pilgrimage.",
        meals: "No Meals (train food at own cost)",
      },
      {
        day: 3,
        date: "30 Oct (Friday)",
        title: "Madurai Sightseeing",
        description:
          "Arrive Madurai at 4:30 AM. After freshening up, visit Thirumalai Nayakkar Palace and the magnificent Meenakshi Amman Temple. Check in and overnight stay.",
        meals: "Breakfast & Dinner",
      },
      {
        day: 4,
        date: "31 Oct (Saturday)",
        title: "Rameshwaram Sightseeing",
        description:
          "Visit Dhanushkodi Beach — the meeting point of Bay of Bengal and Indian Ocean. See the APJ Abdul Kalam Memorial House. Seek blessings at Ramanathaswamy Temple (one of the 12 Jyotirlingas & Char Dham). Dinner and overnight stay.",
        meals: "Breakfast & Dinner",
      },
      {
        day: 5,
        date: "01 Nov (Sunday)",
        title: "Kanyakumari Sightseeing",
        description:
          "Check out and head to Kanyakumari. En route visit Pamban Beach and APJ Abdul Kalam Museum. Visit Kanyakumari Temple and Vivekananda Rock Memorial. Witness the mesmerising sunset at Sunset Point. Dinner and overnight stay.",
        meals: "Breakfast & Dinner",
      },
      {
        day: 6,
        date: "02 Nov (Monday)",
        title: "Trivandrum Sightseeing",
        description:
          "Morning breakfast and head to Thiruvananthapuram. En route enjoy Poovar Backwaters (boating at own expense). Visit Sree Anantha Padmanabhaswamy Temple — one of the oldest and richest temples in India. Dinner and overnight stay.",
        meals: "Breakfast & Dinner",
      },
      {
        day: 7,
        date: "03 Nov (Tuesday)",
        title: "Depart to Mumbai",
        description:
          "Wake up call. Breakfast. Check out and reach station by 9:00 AM. Board Netravati Exp (16346) for Mumbaikars or Cape Pune Exp (16382) for Punekars. Enjoy the return journey with fellow travellers.",
        meals: "Breakfast",
      },
      {
        day: 8,
        date: "04 Nov (Wednesday)",
        title: "Reach Mumbai / Pune",
        description:
          "Reach LTT Mumbai by 5:00 PM and Pune station by 9:45 PM. Return Home with Sweet Memories!",
        meals: "No Meals",
      },
    ],
    inclusions: [
      "Both way SL Train Tickets (3AC upgrade available)",
      "Non-AC Tempo Traveller / Bus for local sightseeing",
      "Accommodation in 3★ Hotel (3/4 Sharing)",
      "5 Breakfasts & 4 Dinners",
      "Entry Fees",
      "1L Mineral Water on sightseeing days",
      "First Aid",
      "Tour Manager",
    ],
    exclusions: [
      "5% GST",
      "Train Food",
      "Lunch",
      "Boating / Activities",
      "Any damage to hotel room",
      "Anything not mentioned in inclusions",
    ],
    pointsToNote: STANDARD_POINTS_TO_NOTE,
    batch: {
      departureDate: "2026-10-28",
      seatsTotal: SEATS_TOTAL_DEFAULT,
      startingPricePaise: 15_999_00,
      lastBookingDate: "2026-07-30",
    },
    priceVariants: [
      { occupancyType: "Sleeper Class", pricePaise: 15_999_00 },
      { occupancyType: "3AC", pricePaise: 18_666_00 },
    ],
    paymentInstallments: [
      {
        sequence: 1,
        label: "1st Installment (Non-Refundable)",
        amountPaise: 7_999_00,
        dueBy: "30 July 2026",
      },
      { sequence: 2, label: "2nd Installment", amountPaise: 8_000_00, dueBy: "15 Sep 2026" },
    ],
    cancellationPolicy: [
      { sequence: 1, cutoff: "On/Before 30 Aug 2026", deduction: "40%" },
      { sequence: 2, cutoff: "On/Before 10 Oct 2026", deduction: "90%" },
      { sequence: 3, cutoff: "After that", deduction: "No Refund" },
    ],
  },
  {
    name: "Nainital-Mussoorie",
    slug: "nainital-mussoorie",
    category: ["adventure", "nature"],
    durationDays: 9,
    durationNights: 8,
    highlights: [
      "Jim Corbett Jungle Jeep Safari",
      "Nainital Naini Lake",
      "Kempty Falls Mussoorie",
      "River Rafting Rishikesh",
      "Kainchi Dham",
    ],
    advisory: "",
    departurePoint: "Bandra Terminus — 11:00 PM, 03 Apr 2026",
    travelMode: "Bandra Haridwar Express (19019)",
    returnPoint: "Reach Mumbai by 10:15 PM, 11 Apr 2026",
    itinerary: [
      {
        day: 1,
        date: "03 Apr (Friday)",
        title: "Board Train at Bandra",
        description:
          "Board Bandra Haridwar Express (19019) at Bandra Terminus at 11:00 PM. Overnight journey to Haridwar.",
        meals: "No Meals",
      },
      {
        day: 2,
        date: "04 Apr (Saturday)",
        title: "Train Journey",
        description: "Continue train journey. Rest and bond with your travel group.",
        meals: "No Meals (train food at own cost)",
      },
      {
        day: 3,
        date: "05 Apr (Sunday)",
        title: "Arrive Haridwar → Mussoorie",
        description:
          "Arrive Haridwar at 8:00 AM. Proceed to Mussoorie — the Queen of Hills. Visit the famous Kempty Falls and enjoy the evening at Mall Road. Dinner and overnight stay.",
        meals: "Dinner",
      },
      {
        day: 4,
        date: "06 Apr (Monday)",
        title: "Rishikesh Adventure",
        description:
          "Head to Rishikesh — the Yoga Capital of the World. Enjoy thrilling River Rafting on the Ganges. Visit Ram Jhula. Witness the evening Ganga Aarti. Dinner and overnight stay.",
        meals: "Breakfast & Dinner",
      },
      {
        day: 5,
        date: "07 Apr (Tuesday)",
        title: "Journey to Nainital via Kainchi Dham",
        description:
          "Breakfast and check out. Journey to Nainital. En route visit Kainchi Dham — a serene spiritual sanctuary and haven for tranquility. Check in at hotel. Dinner and overnight stay.",
        meals: "Breakfast & Dinner",
      },
      {
        day: 6,
        date: "08 Apr (Wednesday)",
        title: "Nainital Sightseeing",
        description:
          "Breakfast and sightseeing in Nainital. Seek blessings at Naina Devi Temple. Enjoy boating at Naini Lake (at own cost). Visit Eco Cave Garden. Evening shopping at Mall Road. Dinner and overnight stay.",
        meals: "Breakfast & Dinner",
      },
      {
        day: 7,
        date: "09 Apr (Thursday)",
        title: "Jim Corbett Jungle Safari",
        description:
          "Breakfast and check out. Proceed to Jim Corbett National Park for an adventurous Jeep Safari through India's most renowned wildlife reserve — famed for Bengal tiger sightings and lush landscapes. Dinner and overnight stay.",
        meals: "Breakfast & Dinner",
      },
      {
        day: 8,
        date: "10 Apr (Friday)",
        title: "Travel to Delhi & Board Train",
        description:
          "Breakfast and check out. Catch the return train from Haridwar Junction by 12:00 PM. Board the overnight train back to Mumbai.",
        meals: "Breakfast",
      },
      {
        day: 9,
        date: "11 Apr (Saturday)",
        title: "Reach Mumbai",
        description: "Reach Mumbai by 10:15 PM. Return Home with Sweet Memories!",
        meals: "No Meals",
      },
    ],
    inclusions: [
      "Mumbai to Mumbai SL Train Tickets (3AC upgrade available)",
      "Non-AC Tempo Traveller for local sightseeing",
      "Deluxe Hotel Accommodation (2-3 Sharing)",
      "Jungle Safari (Jim Corbett)",
      "Breakfast & Dinner",
      "Entry Fees",
      "First Aid",
      "Tour Manager",
    ],
    exclusions: [
      "5% GST",
      "Meals during train journey",
      "All day Lunch",
      "Mineral Water",
      "Personal expenses",
      "Anything not mentioned in inclusions",
    ],
    pointsToNote: STANDARD_POINTS_TO_NOTE,
    batch: {
      departureDate: "2026-04-03",
      seatsTotal: SEATS_TOTAL_DEFAULT,
      startingPricePaise: 19_499_00,
      lastBookingDate: "2026-01-30",
    },
    priceVariants: [
      { occupancyType: "Sleeper Class", pricePaise: 19_499_00 },
      { occupancyType: "3AC", pricePaise: 21_999_00 },
    ],
    paymentInstallments: [
      {
        sequence: 1,
        label: "1st Installment (Non-Refundable)",
        amountPaise: 7_499_00,
        dueBy: "30 Jan 2026",
      },
      { sequence: 2, label: "2nd Installment", amountPaise: 6_000_00, dueBy: "27 Feb 2026" },
      { sequence: 3, label: "3rd Installment", amountPaise: 6_000_00, dueBy: "23 Mar 2026" },
    ],
    cancellationPolicy: [
      { sequence: 1, cutoff: "On/Before 20 Feb 2026", deduction: "50%" },
      { sequence: 2, cutoff: "On/Before 25 Mar 2026", deduction: "90%" },
      { sequence: 3, cutoff: "After that", deduction: "No Refund" },
    ],
  },
  {
    name: "Sikkim-Darjeeling",
    slug: "sikkim-darjeeling",
    category: ["adventure", "nature"],
    durationDays: 7,
    durationNights: 6,
    highlights: [
      "Tsomgo Lake at 12,400 ft",
      "Nathula Pass at 14,500 ft",
      "Darjeeling Toy Train Ride",
      "Tiger Hill Sunrise at 2,590m",
      "Pemayangtse Monastery",
    ],
    advisory: "",
    flightInformation:
      "Suggested flight: Indigo 6E 5305 (BOM 7:50 AM → IXB 10:50 AM) on 03 Sep 2026. Return: Akasa Air QP 1132 (IXB 1:55 PM → BOM 5:05 PM) on 09 Sep 2026. Flights to be booked independently.",
    departurePoint: "Mumbai (BOM) → Bagdogra (IXB) — 03 Sep 2026",
    travelMode: "Fly to Bagdogra — pickup at airport",
    returnPoint: "Bagdogra (IXB) → Mumbai (BOM) — 09 Sep 2026",
    itinerary: [
      {
        day: 1,
        date: "03 Sep (Thursday)",
        title: "Arrive Bagdogra → Gangtok",
        description:
          "Fly to Bagdogra (IXB). Pickup at airport. Drive to Gangtok — 120 km (approx. 4.5 hrs). Check in at hotel. Evening at leisure to explore MG Marg. Dinner and overnight stay.",
        meals: "Dinner",
      },
      {
        day: 2,
        date: "04 Sep (Friday)",
        title: "Tsomgo Lake & Baba Mandir",
        description:
          "Visit Tsomgo Lake at 12,400 ft — a glacial lake of stunning beauty. Proceed to New Baba Mandir at 13,200 ft. Optional visit to Nathula Pass at 14,500 ft (India-China border; own cost). Dinner and overnight stay.",
        meals: "Breakfast & Dinner",
      },
      {
        day: 3,
        date: "05 Sep (Saturday)",
        title: "Gangtok → Pelling via Namchi",
        description:
          "Check out and drive to Pelling. En route visit Siddheswar Dham at Namchi — a grand pilgrimage complex. Check in at hotel. Dinner and overnight stay in Pelling.",
        meals: "Breakfast & Dinner",
      },
      {
        day: 4,
        date: "06 Sep (Sunday)",
        title: "Pelling Sightseeing",
        description:
          "Visit Orange Garden, Rimbi Waterfalls, Pemayangtse Monastery (one of the oldest monasteries in Sikkim), Rabdantse Ruins, and Pelling Sky Walk. Enjoy Ropeway (ticket included). Dinner and overnight stay.",
        meals: "Breakfast & Dinner",
      },
      {
        day: 5,
        date: "07 Sep (Monday)",
        title: "Pelling → Darjeeling",
        description:
          "Breakfast and check out. Drive to Darjeeling — 80 km (approx. 4 hrs). Check in at hotel. Enjoy the famous Toy Train ride: Darjeeling–Ghum–Darjeeling (at own cost; prior booking mandatory). Dinner and overnight stay.",
        meals: "Breakfast & Dinner",
      },
      {
        day: 6,
        date: "08 Sep (Tuesday)",
        title: "Darjeeling Sightseeing",
        description:
          "Wake up at 4:00 AM for the spectacular sunrise from Tiger Hill (2,590m). Visit Himalayan Mountaineering Institute, Padmaja Naidu Zoological Park (closed Thursdays), Tenzing Rock, Tibetan Refugee Self-help Centre (closed Sundays), and Tea Garden (Chitrey outer view). Dinner and overnight stay.",
        meals: "Breakfast & Dinner",
      },
      {
        day: 7,
        date: "09 Sep (Wednesday)",
        title: "Return Journey",
        description:
          "Packed breakfast and check out. Drive from Darjeeling to Bagdogra Airport (IXB). Board return flight to Mumbai. Return Home with Sweet Memories!",
        meals: "Breakfast",
      },
    ],
    inclusions: [
      "Xylo/Ertiga/Innova for local sightseeing (AC inactive in hilly areas)",
      "3★ Accommodation (2-3 Sharing)",
      "Entry Fees",
      "Breakfast & Dinner",
      "Pelling Ropeway Tickets",
      "Mineral Water (1L on sightseeing days)",
      "First Aid",
      "Tour Manager",
    ],
    exclusions: [
      "Train / Airfare (book independently)",
      "5% GST",
      "Sharing cab for Nathula Pass",
      "Nathula Entry Pass & Namchi Village",
      "Toy Train Tickets",
      "Travel/Medical Insurance",
      "Camera Fees",
      "Heater Charges",
      "Anything not mentioned in inclusions",
    ],
    pointsToNote: STANDARD_POINTS_TO_NOTE,
    batch: {
      departureDate: "2026-09-03",
      seatsTotal: SEATS_TOTAL_DEFAULT,
      startingPricePaise: 27_777_00,
      lastBookingDate: "2026-06-20",
    },
    priceVariants: [],
    paymentInstallments: [
      {
        sequence: 1,
        label: "1st Installment (Non-Refundable)",
        amountPaise: 9_777_00,
        dueBy: "20 June 2026",
      },
      { sequence: 2, label: "2nd Installment", amountPaise: 9_000_00, dueBy: "30 July 2026" },
      { sequence: 3, label: "3rd Installment", amountPaise: 9_000_00, dueBy: "20 Aug 2026" },
    ],
    cancellationPolicy: [
      { sequence: 1, cutoff: "On/Before 05 Aug 2026", deduction: "40%" },
      { sequence: 2, cutoff: "On/Before 25 Aug 2026", deduction: "90%" },
      { sequence: 3, cutoff: "After that", deduction: "No Refund" },
    ],
  },
  {
    name: "Ayodhya-Kashi-Prayagraj",
    slug: "ayodhya-kashi-prayagraj",
    category: ["spiritual"],
    durationDays: 6,
    durationNights: 5,
    highlights: [
      "Ram Mandir Ayodhya",
      "Kashi Vishwanath Temple",
      "Ganga Aarti Dashashwamedh Ghat",
      "Triveni Sangam Prayagraj",
      "Saryu River Aarti",
    ],
    advisory: "",
    departurePoint: "LTT Mumbai — 10:00 AM, 26 Sep 2026",
    travelMode: "Jaynagar Pawan Express (11061)",
    returnPoint: "Patliputra-Mumbai LTT SF Express (12142), Arrive Mumbai 3:00 PM, 01 Oct 2026",
    itinerary: [
      {
        day: 1,
        date: "26 Sep (Saturday)",
        title: "Board Train at LTT Mumbai",
        description:
          "Board Jaynagar Pawan Express (11061) at LTT at 10:00 AM. Overnight journey to Varanasi.",
        meals: "No Meals",
      },
      {
        day: 2,
        date: "27 Sep (Sunday)",
        title: "Arrive Varanasi — Ganga Aarti",
        description:
          "Arrive Varanasi at 1:00 PM. Check in and freshen up. Evening: witness the grand Ganga Aarti at Dashashwamedh Ghat — one of the most spectacular spiritual experiences in India. Dinner and overnight stay.",
        meals: "Dinner",
      },
      {
        day: 3,
        date: "28 Sep (Monday)",
        title: "Kashi Sightseeing",
        description:
          "Early morning 5:00 AM darshan at the sacred Kashi Vishwanath Temple. Visit Kalbhairav Temple and Devi Annapoorna Temple. Explore the ancient ghats of Varanasi. Dinner and overnight stay.",
        meals: "Breakfast & Dinner",
      },
      {
        day: 4,
        date: "29 Sep (Tuesday)",
        title: "Ayodhya Sightseeing",
        description:
          "Early morning departure to Ayodhya. Visit the magnificent Ram Janmbhoomi and Ram Mandir. Seek blessings at Hanuman Gadhi. Take a holy dip and witness aarti at Saryu River. Dinner and overnight stay.",
        meals: "Breakfast & Dinner",
      },
      {
        day: 5,
        date: "30 Sep (Wednesday)",
        title: "Prayagraj — Triveni Sangam",
        description:
          "Head to Prayagraj. Visit Triveni Sangam — the sacred confluence of Ganga, Yamuna, and the invisible Saraswati. Seek blessings at Bade Hanumanji Temple. Board the return train to Mumbai.",
        meals: "Breakfast",
      },
      {
        day: 6,
        date: "01 Oct (Thursday)",
        title: "Arrive Mumbai",
        description:
          "Arrive Mumbai at 3:00 PM via Patliputra-Mumbai LTT SF Express (12142). Return Home with Sweet Memories!",
        meals: "No Meals",
      },
    ],
    inclusions: [
      "SL Train Tickets (3AC/2AC upgrade available)",
      "AC Tempo Traveller for sightseeing",
      "Auto for local travel",
      "Deluxe Hotel (2-3 Sharing)",
      "Breakfast & Dinner",
      "Mineral Water",
      "Entry Fees",
      "First Aid",
      "Tour Manager",
    ],
    exclusions: [
      "5% GST",
      "Train Food",
      "Lunch",
      "Boating Charges",
      "Personal expenses",
      "Anything not mentioned in inclusions",
    ],
    pointsToNote: STANDARD_POINTS_TO_NOTE,
    batch: {
      departureDate: "2026-09-26",
      seatsTotal: SEATS_TOTAL_DEFAULT,
      startingPricePaise: 14_444_00,
      lastBookingDate: "2026-07-10",
    },
    priceVariants: [
      { occupancyType: "Sleeper Class", pricePaise: 14_444_00 },
      { occupancyType: "3AC", pricePaise: 16_999_00 },
      { occupancyType: "2AC", pricePaise: 18_666_00 },
    ],
    // The source only gives "Confirm by 10 July 2026" for the 1st installment
    // (no numeric amount); its amount is derived as the remainder after the
    // 2nd and 3rd installments, since those two do total less than the price.
    paymentInstallments: [
      { sequence: 1, label: "1st Installment", amountPaise: 6_444_00, dueBy: "10 July 2026" },
      { sequence: 2, label: "2nd Installment", amountPaise: 4_000_00, dueBy: "15 Aug 2026" },
      { sequence: 3, label: "3rd Installment", amountPaise: 4_000_00, dueBy: "15 Sep 2026" },
    ],
    cancellationPolicy: [
      { sequence: 1, cutoff: "On/Before 20 Aug 2026", deduction: "40%" },
      { sequence: 2, cutoff: "On/Before 17 Sep 2026", deduction: "90%" },
      { sequence: 3, cutoff: "After that", deduction: "No Refund" },
    ],
  },
  {
    name: "Ujjain-Indore-Omkareshwar",
    slug: "ujjain-indore",
    category: ["spiritual"],
    durationDays: 5,
    durationNights: 4,
    highlights: [
      "Mahakaleshwar Jyotirlinga",
      "Omkareshwar Jyotirlinga",
      "Mahakal Corridor Ujjain",
      "Lal Baug Palace Indore",
      "56 Bhog Street Food Market",
    ],
    advisory: "",
    departurePoint: "Pune Jn. — 2:45 PM, 25 Jun 2026 | Kalyan Jn. — 5:30 PM, 25 Jun 2026",
    travelMode: "Train to Indore",
    returnPoint: "28 Jun evening, Arrive home 29 Jun",
    itinerary: [
      {
        day: 1,
        date: "25 Jun (Thursday)",
        title: "Board Train",
        description:
          "Board train at Pune Jn. at 2:45 PM or Kalyan Jn. at 5:30 PM. Overnight journey to Indore.",
        meals: "No Meals",
      },
      {
        day: 2,
        date: "26 Jun (Friday)",
        title: "Indore Sightseeing",
        description:
          "Arrive Indore. Check in and freshen up. Explore Indore: Rajwada (historic palace), Lal Baug Palace, Kaanch Mandir (Glass Temple), Khajrana Ganesh Temple. Evening at the famous 56 Bhog Street Food Market. Dinner and overnight stay.",
        meals: "Breakfast & Dinner",
      },
      {
        day: 3,
        date: "27 Jun (Saturday)",
        title: "Omkareshwar & Mahakal Corridor",
        description:
          "Morning visit to Omkareshwar Jyotirlinga — one of the 12 sacred Jyotirlingas located on an island shaped like the OM symbol. Evening: stroll through the magnificent Mahakal Corridor in Ujjain. Check in at hotel in Ujjain. Dinner and overnight stay.",
        meals: "Breakfast & Dinner",
      },
      {
        day: 4,
        date: "28 Jun (Sunday)",
        title: "Ujjain Sightseeing & Depart",
        description:
          "Visit Mahakaleshwar Jyotirlinga — one of the 12 Jyotirlingas with the famous Bhasma Aarti. Visit Kalbhairav Temple, Harsiddhi Mata Temple, Maharishi Sandipani Ashram, and Mangalnath Temple. Board the return train in the evening.",
        meals: "Breakfast",
      },
      {
        day: 5,
        date: "29 Jun (Monday)",
        title: "Arrive Home",
        description: "Arrive at home station in the morning. Return Home with Sweet Memories!",
        meals: "No Meals",
      },
    ],
    inclusions: [
      "SL Train Tickets (both ways)",
      "Tempo Traveller for local sightseeing",
      "3★ Accommodation",
      "Breakfast & Dinner",
      "Mineral Water",
      "Entry Fees",
      "First Aid",
      "Tour Buddy",
    ],
    exclusions: [
      "5% GST",
      "Train Food",
      "Lunch",
      "Personal expenses",
      "Anything not mentioned in inclusions",
    ],
    pointsToNote: STANDARD_POINTS_TO_NOTE,
    batch: {
      departureDate: "2026-06-25",
      seatsTotal: SEATS_TOTAL_DEFAULT,
      startingPricePaise: 8_999_00,
      lastBookingDate: null,
    },
    priceVariants: [],
    paymentInstallments: [],
    cancellationPolicy: [],
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
    config: { holdingReplyMessage: DEFAULT_HOLDING_REPLY },
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
        flightInformation: seedPackage.flightInformation,
        departurePoint: seedPackage.departurePoint,
        travelMode: seedPackage.travelMode,
        returnPoint: seedPackage.returnPoint,
        itinerary: seedPackage.itinerary,
        inclusions: seedPackage.inclusions,
        exclusions: seedPackage.exclusions,
        pointsToNote: seedPackage.pointsToNote,
      })
      .returning();

    const [insertedBatch] = await db
      .insert(batches)
      .values({
        tenantId: tenant.id,
        packageId: insertedPackage.id,
        departureDate: seedPackage.batch.departureDate,
        seatsTotal: seedPackage.batch.seatsTotal,
        seatsAvailable: seedPackage.batch.seatsTotal,
        startingPricePaise: seedPackage.batch.startingPricePaise,
        lastBookingDate: seedPackage.batch.lastBookingDate,
      })
      .returning();

    if (seedPackage.priceVariants.length > 0) {
      await db.insert(batchPriceVariants).values(
        seedPackage.priceVariants.map((variant) => ({
          tenantId: tenant.id,
          batchId: insertedBatch.id,
          ...variant,
        })),
      );
    }

    if (seedPackage.paymentInstallments.length > 0) {
      await db.insert(paymentInstallments).values(
        seedPackage.paymentInstallments.map((installment) => ({
          tenantId: tenant.id,
          packageId: insertedPackage.id,
          ...installment,
        })),
      );
    }

    if (seedPackage.cancellationPolicy.length > 0) {
      await db.insert(cancellationRules).values(
        seedPackage.cancellationPolicy.map((rule) => ({
          tenantId: tenant.id,
          packageId: insertedPackage.id,
          ...rule,
        })),
      );
    }
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
