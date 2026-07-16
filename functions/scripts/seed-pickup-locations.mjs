import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { readFileSync } from "node:fs";

const pickupLocations = [
  {
    id: "home-paami",
    name: "\u05d4\u05d5\u05dd \u05e4\u05e2\u05de\u05d9",
    address:
      "\u05e9\u05d3\u05e8\u05d5\u05ea \u05e9\u05e2\u05d5\u05e8\u05d4 1, \u05dc\u05d4\u05d1\u05d9\u05dd",
    openingHours:
      "\u05d0'-\u05d4' 10:00-19:00, \u05d5' 09:00-12:00",
    weeklyHours: {
      0: [{ open: "10:00", close: "19:00" }],
      1: [{ open: "10:00", close: "19:00" }],
      2: [{ open: "10:00", close: "19:00" }],
      3: [{ open: "10:00", close: "19:00" }],
      4: [{ open: "10:00", close: "19:00" }],
      5: [{ open: "09:00", close: "12:00" }],
    },
    navigationUrl:
      "https://www.google.com/maps/search/?api=1&query=%D7%94%D7%95%D7%9D%20%D7%A4%D7%A2%D7%9E%D7%99%20%D7%A9%D7%93%D7%A8%D7%95%D7%AA%20%D7%A9%D7%A2%D7%95%D7%A8%D7%94%201%20%D7%9C%D7%94%D7%91%D7%99%D7%9D",
    sortOrder: 10,
  },
  {
    id: "post-office",
    name: "\u05d3\u05d5\u05d0\u05e8 \u05dc\u05d4\u05d1\u05d9\u05dd",
    address:
      "\u05e8\u05d9\u05de\u05d5\u05df 1, \u05dc\u05d4\u05d1\u05d9\u05dd",
    openingHours:
      "\u05d0', \u05d4' 13:00-18:00, \u05d1'-\u05d3' 11:00-15:00, \u05d5' 09:00-12:00",
    weeklyHours: {
      0: [{ open: "13:00", close: "18:00" }],
      1: [{ open: "11:00", close: "15:00" }],
      2: [{ open: "11:00", close: "15:00" }],
      3: [{ open: "11:00", close: "15:00" }],
      4: [{ open: "13:00", close: "18:00" }],
      5: [{ open: "09:00", close: "12:00" }],
    },
    navigationUrl:
      "https://www.google.com/maps/search/?api=1&query=%D7%93%D7%95%D7%90%D7%A8%20%D7%9C%D7%94%D7%91%D7%99%D7%9D%20%D7%A8%D7%99%D7%9E%D7%95%D7%9F%201",
    sortOrder: 20,
  },
  {
    id: "pitzutz",
    name:
      "\u05e4\u05d9\u05e6\u05d5\u05e5 \u05dc\u05d4\u05d1\u05d9\u05dd",
    address:
      "\u05de\u05ea\u05d7\u05dd \u05de\u05d1\u05e0\u05d4 \u05dc\u05d4\u05d1\u05d9\u05dd",
    openingHours:
      "\u05d0'-\u05d4' 10:00-14:00, 18:00-21:00",
    weeklyHours: {
      0: [
        { open: "10:00", close: "14:00" },
        { open: "18:00", close: "21:00" },
      ],
      1: [
        { open: "10:00", close: "14:00" },
        { open: "18:00", close: "21:00" },
      ],
      2: [
        { open: "10:00", close: "14:00" },
        { open: "18:00", close: "21:00" },
      ],
      3: [
        { open: "10:00", close: "14:00" },
        { open: "18:00", close: "21:00" },
      ],
      4: [
        { open: "10:00", close: "14:00" },
        { open: "18:00", close: "21:00" },
      ],
    },
    navigationUrl:
      "https://www.google.com/maps/search/?api=1&query=%D7%A4%D7%99%D7%A6%D7%95%D7%A5%20%D7%9C%D7%94%D7%91%D7%99%D7%9D",
    sortOrder: 30,
  },
  {
    id: "eshkolot",
    name: "\u05d0\u05e9\u05db\u05d5\u05dc\u05d5\u05ea",
    address:
      "\u05de\u05d6\u05db\u05d9\u05e8\u05d5\u05ea \u05d0\u05e9\u05db\u05d5\u05dc\u05d5\u05ea",
    openingHours:
      "\u05d0'-\u05d4' 08:00-13:00, \u05d5' \u05e1\u05d2\u05d5\u05e8",
    weeklyHours: {
      0: [{ open: "08:00", close: "13:00" }],
      1: [{ open: "08:00", close: "13:00" }],
      2: [{ open: "08:00", close: "13:00" }],
      3: [{ open: "08:00", close: "13:00" }],
      4: [{ open: "08:00", close: "13:00" }],
      5: [],
    },
    navigationUrl:
      "https://www.google.com/maps/search/?api=1&query=%D7%9E%D7%96%D7%9B%D7%99%D7%A8%D7%95%D7%AA%20%D7%90%D7%A9%D7%9B%D7%95%D7%9C%D7%95%D7%AA",
    sortOrder: 40,
  },
  {
    id: "deli-place",
    name:
      "\u05d3\u05dc\u05d9 \u05e4\u05dc\u05d9\u05d9\u05e1",
    address:
      "\u05e9\u05d3\u05e8\u05d5\u05ea \u05e9\u05e2\u05d5\u05e8\u05d4 1, \u05dc\u05d4\u05d1\u05d9\u05dd",
    openingHours:
      "\u05d0'-\u05d4' 08:30-14:00, 16:00-20:00, \u05d5' 07:30-14:00",
    weeklyHours: {
      0: [
        { open: "08:30", close: "14:00" },
        { open: "16:00", close: "20:00" },
      ],
      1: [
        { open: "08:30", close: "14:00" },
        { open: "16:00", close: "20:00" },
      ],
      2: [
        { open: "08:30", close: "14:00" },
        { open: "16:00", close: "20:00" },
      ],
      3: [
        { open: "08:30", close: "14:00" },
        { open: "16:00", close: "20:00" },
      ],
      4: [
        { open: "08:30", close: "14:00" },
        { open: "16:00", close: "20:00" },
      ],
      5: [{ open: "07:30", close: "14:00" }],
    },
    navigationUrl:
      "https://www.google.com/maps/search/?api=1&query=%D7%93%D7%9C%D7%99%20%D7%A4%D7%9C%D7%99%D7%99%D7%A1%20%D7%A9%D7%93%D7%A8%D7%95%D7%AA%20%D7%A9%D7%A2%D7%95%D7%A8%D7%94%201%20%D7%9C%D7%94%D7%91%D7%99%D7%9D",
    sortOrder: 50,
  },
  {
    id: "shoval",
    name: "\u05e9\u05d5\u05d1\u05dc",
    address:
      "\u05d3\u05d5\u05d0\u05e8 \u05e9\u05d5\u05d1\u05dc",
    openingHours:
      "\u05e6\u05e8\u05d9\u05da \u05dc\u05d0\u05de\u05ea \u05e9\u05e2\u05d5\u05ea \u05e4\u05ea\u05d9\u05d7\u05d4",
    navigationUrl:
      "https://www.google.com/maps/search/?api=1&query=%D7%93%D7%95%D7%90%D7%A8%20%D7%A9%D7%95%D7%91%D7%9C",
    sortOrder: 60,
  },
];

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const projectId = readArg("--project") ?? process.env.GCLOUD_PROJECT ?? process.env.FIREBASE_PROJECT_ID;
const serviceAccountPath = readArg("--service-account") ?? process.env.GOOGLE_APPLICATION_CREDENTIALS;

function readArg(name) {
  const direct = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (direct) return direct.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function initFirebaseAdmin() {
  if (getApps().length) return;

  if (serviceAccountPath) {
    const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, "utf8"));
    initializeApp({
      credential: cert(serviceAccount),
      projectId: projectId ?? serviceAccount.project_id,
    });
    return;
  }

  initializeApp(projectId ? { projectId } : undefined);
}

async function seedPickupLocations() {
  if (dryRun) {
    console.log(`Dry run: ${pickupLocations.length} pickup locations would be upserted.`);
    pickupLocations.forEach((location) => {
      console.log(`${location.id}: ${location.name} | ${location.address}`);
    });
    return;
  }

  initFirebaseAdmin();
  const db = getFirestore();
  const batch = db.batch();
  const now = new Date().toISOString();
  const existingSnapshots = await Promise.all(
    pickupLocations.map((location) => db.doc(`pickupLocations/${location.id}`).get()),
  );

  pickupLocations.forEach((location, index) => {
    const existing = existingSnapshots[index];
    batch.set(
      db.doc(`pickupLocations/${location.id}`),
      {
        ...location,
        activeRequests: existing.exists ? (existing.data()?.activeRequests ?? 0) : 0,
        isActive: true,
        updatedAt: now,
      },
      { merge: true },
    );
  });

  await batch.commit();
  console.log(`Seeded ${pickupLocations.length} pickup locations.`);
}

seedPickupLocations().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
