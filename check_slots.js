const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const slots = await prisma.timeSlot.findMany({ orderBy: [{level:'asc'},{shift:'asc'},{dayOfWeek:'asc'},{period:'asc'}] });
  console.log('Total TimeSlots:', slots.length);
  const byLevelShift = slots.reduce((acc, s) => {
    const key = s.level + ' ' + s.shift;
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  console.log('Por nível/turno:', byLevelShift);
  slots.slice(0, 12).forEach(s => console.log(s.level, s.shift, 'Dia', s.dayOfWeek, 'Período', s.period, s.startTime, '-', s.endTime));
}
main().finally(() => prisma.$disconnect());