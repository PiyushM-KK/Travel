/**
 * Skyline Travel Planner — social media fact base.
 *
 * SOURCE OF TRUTH: the live Skyline site, which lives in its OWN repo
 * (PiyushM-KK/Travel, served at https://skylinetravelplanner.com/) at
 *   C:\Users\PiyushM\OneDrive\Documents\WebSite_looknbooks\Skyline Travel Planner Launch
 *
 * We deliberately do NOT copy that project in here. It has its own git remote,
 * its own GitHub Pages deploy and its own handover docs; duplicating it would
 * create exactly the two-sources-of-truth drift this engine exists to prevent.
 * Instead this file mirrors the facts the social engine needs.
 *
 * ⚠️ THIS FILE IS A MIRROR, AND MIRRORS GO STALE.
 * Packages and prices below were extracted from `Domestic.dc.html` and
 * `International.dc.html` on **2026-07-20**. When Skyline changes a package or a
 * price, update this file too — `npm run check` will not catch the drift for
 * you, because the two repos cannot see each other.
 *
 * The restaurant equivalent (bot/kb.js) does not have this problem, because the
 * bot and the social engine share one repo and one file. That is the better
 * arrangement, and if Skyline ever moves in here, delete this mirror.
 */

const BUSINESS = {
  name: "Skyline Travel Planner",
  kind: "customized tour operator — India and beyond",
  tagline: "Customized Tours Across India & Beyond",
  slogan: "Your Journey, Our Passion", // the brand slogan printed on Skyline's own posters
  positioning: "Domestic Tour Operator", // per Skyline's official marketing material
  email: "Info@skylinetravelplanner.com",
  instagram: "@skylinetravelplanner",

  // Not shopfronts — the channels a customer actually reaches. The adapter's
  // "locations" shape is reused so the validator can check contact details.
  locations: [
    {
      area: "WhatsApp",
      address: "Primary enquiry channel",
      hours: "Replies during business hours",
      phone: "+91 88660 50291", // PRIMARY (8866050291)
    },
    {
      area: "Phone",
      address: "Additional contact — Bhavik Baker",
      hours: "Business hours",
      phone: "+91 90330 20291", // secondary, owner-verified (9033020291)
    },
  ],

  website: "https://skylinetravelplanner.com/",

  // How a trip actually gets booked. Note what is NOT here: no online payment,
  // no instant booking. Every package starts as an enquiry.
  howToBook: {
    enquiry: "Tell us your dates, group and interests through the Customize form and we build a plan around them",
    whatsapp: "Or message us on WhatsApp at +91 88660 50291",
    quote: "Every trip is quoted individually — nothing is booked or paid for on the website",
  },

  // ⚠️ Load-bearing. Skyline's Flights / Trains / Buses pages REFER OUT to
  // official providers and take no payment. A post saying "book your flights
  // with us" would be false. validate-post.js blocks it.
  referralOnly: ["flights", "trains", "buses", "cabs"],

  // The site's AI assistant already appends this whenever it quotes a price.
  // The social engine holds itself to the same standard — see validate-post.js,
  // which requires indicative-price language whenever ₹ appears in a caption.
  priceDisclaimer:
    "Prices are indicative starting-from estimates and can change with season, hotel availability and current rates.",

  notes: {
    customization:
      "Every package is a starting point, not a fixed product — dates, hotels, pace and inclusions are all adjustable.",
    pricing:
      "Prices shown are per-person starting-from estimates for the standard itinerary. The real quote depends on travel dates, group size, hotel category and current rates.",
    hotels:
      "Hotels are offered in 3-star (comfort and value), 4-star (premium) and 5-star (luxury) tiers.",
    flights:
      "We do not sell or book flights, trains, buses or cabs. Those pages link out to the official providers, and no payment is taken through us.",
  },

  catalogue: {
    // Bestsellers to lead with. Taken from the site's own tags.
    popular: ["Royal Rajasthan", "Kerala Backwaters", "Kashmir Valley", "Meghalaya Wonders"],

    categories: {
      "North India": [
        { item: "Royal Rajasthan", price: "₹24,900", duration: "7N / 8D", tag: "Heritage", route: "Jaipur · Jodhpur · Udaipur · Jaisalmer" },
        { item: "Himachal Hills", price: "₹21,500", duration: "6N / 7D", tag: "Family", route: "Shimla · Manali · Dharamshala" },
        { item: "Kashmir Valley", price: "₹27,800", duration: "5N / 6D", tag: "Honeymoon", route: "Srinagar · Gulmarg · Pahalgam · Sonamarg" },
        { item: "Kausani & Kumaon", price: "₹19,700", duration: "5N / 6D", tag: "Off-beat", route: "Kausani · Baijnath · Almora · Bageshwar" },
      ],
      "Western India": [
        { item: "Gujarat Darshan", price: "₹22,400", duration: "6N / 7D", tag: "Religious", route: "Dwarka · Somnath · Statue of Unity · Kutch" },
        { item: "Goa Getaway", price: "₹16,900", duration: "4N / 5D", tag: "Couples", route: "North Goa · South Goa · Beaches" },
        { item: "Braj & Agra Yatra", price: "₹12,500", duration: "3N / 4D", tag: "Spiritual", route: "Mathura · Vrindavan · Gokul · Agra" },
      ],
      "East India": [
        { item: "Sikkim Discovery", price: "₹25,600", duration: "6N / 7D", tag: "Mountains", route: "Gangtok · Pelling · Lachung · North Sikkim" },
        { item: "Sikkim Honeymoon", price: "₹23,200", duration: "5N / 6D", tag: "Honeymoon", route: "Gangtok · Tsomgo Lake · Pelling" },
        { item: "Gangtok & Darjeeling", price: "₹24,100", duration: "6N / 7D", tag: "Scenic", route: "Darjeeling · Gangtok · Tea gardens" },
      ],
      "Northeast India": [
        { item: "Meghalaya Wonders", price: "₹28,900", duration: "6N / 7D", tag: "Scenic", route: "Shillong · Cherrapunji · Dawki · Mawlynnong" },
        { item: "Assam & Kaziranga", price: "₹26,400", duration: "5N / 6D", tag: "Wildlife", route: "Guwahati · Kaziranga · Majuli · Tea gardens" },
        { item: "Arunachal Explorer", price: "₹34,500", duration: "7N / 8D", tag: "Adventure", route: "Tawang · Bomdila · Dirang · Sela Pass" },
        { item: "Nagaland Highlands", price: "₹29,800", duration: "6N / 7D", tag: "Culture", route: "Kohima · Dzukou Valley · Khonoma" },
        { item: "Manipur & Loktak", price: "₹27,600", duration: "5N / 6D", tag: "Off-beat", route: "Imphal · Loktak Lake · Kangla · Moirang" },
        { item: "Mizoram Discovery", price: "₹30,200", duration: "6N / 7D", tag: "Off-beat", route: "Aizawl · Reiek · Hmuifang · Vantawng" },
      ],
      "South India": [
        { item: "Kerala Backwaters", price: "₹23,900", duration: "6N / 7D", tag: "Family", route: "Kochi · Munnar · Thekkady · Alappuzha" },
        { item: "Mysuru–Coorg–Ooty", price: "₹20,800", duration: "6N / 7D", tag: "Hill stations", route: "Bengaluru · Mysuru · Coorg · Ooty" },
        { item: "South Temple Trail", price: "₹19,400", duration: "5N / 6D", tag: "Religious", route: "Madurai · Rameswaram · Kanyakumari" },
      ],
      International: [
        { item: "Thailand Explorer", price: "₹42,000", duration: "6N / 7D", tag: "Bestseller", route: "Bangkok · Pattaya · Phuket · Krabi" },
        { item: "Bali Honeymoon", price: "₹46,000", duration: "6N / 7D", tag: "Honeymoon", route: "Kuta · Ubud · Seminyak · Nusa Penida" },
        { item: "Maldives Escape", price: "₹58,000", duration: "4N / 5D", tag: "Luxury", route: "Beach or overwater villa · Male atolls" },
      ],
    },
  },
};

/**
 * Every location listed on the site — the individual places inside the package
 * routes, not just the packages. Extracted from the route fields across all
 * pages on 2026-07-20.
 *
 * THIS IS THE CONTENT ASSET. 22 packages is a good year of posts; ~90 named
 * places is several years, because each one is a post in its own right and most
 * of them nobody else is writing about. Dawki, Khonoma, Hmuifang and Vantawng
 * are the whole differentiator — you cannot buy those trips from a big OTA.
 */
const LOCATIONS = [
  // North India
  "Jaipur", "Jodhpur", "Udaipur", "Jaisalmer", "Rajasthan",
  "Shimla", "Manali", "Dharamshala", "Himachal",
  "Srinagar", "Gulmarg", "Pahalgam", "Sonamarg", "Kashmir",
  "Kausani", "Baijnath", "Almora", "Bageshwar", "Uttarakhand",
  // Western India
  "Dwarka", "Somnath", "Statue of Unity", "Kutch",
  "North Goa", "South Goa", "Goa",
  "Mathura", "Vrindavan", "Gokul", "Agra",
  // East India
  "Gangtok", "Pelling", "Lachung", "North Sikkim", "Sikkim",
  "Tsomgo Lake", "Darjeeling",
  // Northeast India — the differentiator
  "Shillong", "Cherrapunji", "Dawki", "Mawlynnong", "Meghalaya",
  "Guwahati", "Kaziranga", "Majuli", "Assam",
  "Tawang", "Bomdila", "Dirang", "Sela Pass", "Arunachal",
  "Kohima", "Dzukou Valley", "Khonoma", "Nagaland",
  "Imphal", "Loktak Lake", "Kangla", "Moirang", "Manipur",
  "Aizawl", "Reiek", "Hmuifang", "Vantawng", "Mizoram",
  // South India
  "Kochi", "Munnar", "Thekkady", "Alappuzha", "Kerala",
  "Bengaluru", "Mysuru", "Coorg", "Ooty",
  "Madurai", "Rameswaram", "Kanyakumari",
  // International
  "Bangkok", "Pattaya", "Phuket", "Krabi", "Thailand",
  "Kuta", "Ubud", "Seminyak", "Nusa Penida", "Bali",
  "Male atolls", "Maldives",
];

/**
 * Destinations we hold a real photograph for. The content calendar flags a post
 * whose subject is NOT in this list, so the owner knows a new photo is needed —
 * an owner who has to source a photo for every post stops sending photos by
 * week three.
 */
const DESTINATIONS_WITH_IMAGES = [
  "Agra", "Arunachal", "Assam", "Bali", "Darjeeling", "Goa", "Himachal",
  "Kashmir", "Kausani", "Kerala", "Maldives", "Manipur", "Meghalaya", "Mizoram",
  "Mysuru", "Nagaland", "Ooty", "Rajasthan", "Sikkim", "Tsomgo Lake",
  "Thailand", "Uttarakhand",
];

module.exports = { BUSINESS, LOCATIONS, DESTINATIONS_WITH_IMAGES };
