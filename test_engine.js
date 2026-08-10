const { PrismaClient } = require('@prisma/client');
async function main() {
  const prisma = new PrismaClient();
  try {
    // Dynamic import of the engine
    const engine = require('./src/app/gerador/engine');
    console.log('Running SCRATCH...');
    const res = await engine.runGenerator('SCRATCH');
    console.log('Result:', JSON.stringify(res, null, 2));
  } catch(e) {
    console.error('ERROR:', e.message);
    console.error(e.stack?.split('\n').slice(0,5).join('\n'));
  } finally {
    await prisma.$disconnect();
  }
}
main();
