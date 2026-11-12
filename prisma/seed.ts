import { PackageTier, PrismaClient, Seat } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash("Password123!", 12);

  await prisma.account.upsert({
    where: { email: "adeel@raza.example" },
    update: {
      placeLabel: "Ugoki Road, Sialkot",
      rating: 4.9,
      ratingCount: 12,
      photoUrl: "seeded",
      package: PackageTier.SILVER,
      latitude: 32.4945,
      longitude: 74.5229,
      placeAccuracyM: 12,
      placeUpdatedAt: new Date(),
    },
    create: {
      email: "adeel@raza.example",
      name: "Adeel Raza",
      phone: "+92 300 555 0142",
      city: "Sialkot",
      placeLabel: "Ugoki Road, Sialkot",
      work: "Surgical instrument maker",
      languages: ["Urdu", "English", "Punjabi"],
      country: "PK",
      currency: "PKR",
      package: PackageTier.SILVER,
      seat: Seat.EXPERT,
      passwordHash,
      photoUrl: "seeded",
      rating: 4.9,
      ratingCount: 12,
      latitude: 32.4945,
      longitude: 74.5229,
      placeAccuracyM: 12,
      placeUpdatedAt: new Date(),
      fingerprintEnrolled: false,
      faceEnrolled: false,
      payoutAccountSet: false,
    },
  });

  await prisma.account.upsert({
    where: { email: "noor@desk.callmetoserve.example" },
    update: {},
    create: {
      email: "noor@desk.callmetoserve.example",
      name: "Noor Javed",
      city: "Sialkot",
      country: "PK",
      currency: "PKR",
      seat: Seat.DESK,
      passwordHash,
      fingerprintEnrolled: false,
      faceEnrolled: false,
    },
  });

  await prisma.account.upsert({
    where: { email: "maaali615@gmail.com" },
    update: {
      seat: Seat.DESK,
      name: "Super Admin",
    },
    create: {
      email: "maaali615@gmail.com",
      name: "Super Admin",
      city: "Sialkot",
      country: "PK",
      currency: "PKR",
      seat: Seat.DESK,
      fingerprintEnrolled: false,
      faceEnrolled: false,
    },
  });

  console.log("Seeded Adeel (expert), Noor (desk), and maaali615@gmail.com (desk).");
  console.log("Experts sign in with Google/Facebook, then enroll fingerprint/face.");
  console.log("Desk: maaali615@gmail.com (email-only desk login).");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
