import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  await prisma.listing.deleteMany();
  await prisma.agent.deleteMany();

  const password = await bcrypt.hash('password123', await bcrypt.genSalt());

  const [agent1, agent2, agent3] = await Promise.all([
    prisma.agent.create({
      data: { email: 'agent1@example.com', password, name: 'Ada Agent' },
    }),
    prisma.agent.create({
      data: { email: 'agent2@example.com', password, name: 'Bola Agent' },
    }),
    prisma.agent.create({
      data: { email: 'agent3@example.com', password, name: 'Chidi Agent' },
    }),
  ]);

  await prisma.listing.createMany({
    data: [
      {
        title: '3-bed apartment in Lekki Phase 1',
        price: 45000000,
        type: 'SALE',
        bedrooms: 3,
        latitude: 6.4488,
        longitude: 3.4732,
        address: 'Lekki Phase 1, Lagos',
        agentId: agent1.id,
      },
      {
        title: 'Cozy 2-bed flat for rent in Ikeja',
        price: 1800000,
        type: 'RENT',
        bedrooms: 2,
        latitude: 6.6018,
        longitude: 3.3515,
        address: 'Ikeja GRA, Lagos',
        agentId: agent1.id,
      },
      {
        title: 'Luxury shortlet studio in Victoria Island',
        price: 85000,
        type: 'SHORTLET',
        bedrooms: 1,
        latitude: 6.4281,
        longitude: 3.4219,
        address: 'Victoria Island, Lagos',
        agentId: agent2.id,
      },
      {
        title: '4-bed duplex for sale in Ajah',
        price: 68000000,
        type: 'SALE',
        bedrooms: 4,
        latitude: 6.4667,
        longitude: 3.5667,
        address: 'Ajah, Lagos',
        agentId: agent2.id,
      },
      {
        title: 'Furnished 1-bed shortlet in Ikoyi',
        price: 95000,
        type: 'SHORTLET',
        bedrooms: 1,
        latitude: 6.4541,
        longitude: 3.4316,
        address: 'Ikoyi, Lagos',
        agentId: agent3.id,
      },
    ],
  });

  // eslint-disable-next-line no-console
  console.log(
    'Seeded agents (password for all: "password123"):',
    [agent1, agent2, agent3].map((a) => a.email).join(', '),
  );
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
