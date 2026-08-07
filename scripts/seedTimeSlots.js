const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

function addMinutes(timeStr, mins) {
  const [h, m] = timeStr.split(':').map(Number);
  const date = new Date(2000, 0, 1, h, m);
  date.setMinutes(date.getMinutes() + mins);
  return date.toTimeString().slice(0, 5);
}

const levels = ['INFANTIL', 'FUND1', 'FUND2'];
const days = [1, 2, 3, 4, 5];

async function seed() {
  await prisma.timeSlot.deleteMany();
  
  for (const level of levels) {
    for (const shift of ['MORNING', 'AFTERNOON']) {
      for (const day of days) {
        
        let startTime = shift === 'MORNING' ? '07:15' : '13:00';
        let duration = (level === 'INFANTIL' || level === 'FUND1') ? 50 : 45;

        if (level === 'FUND2' && day === 5 && shift === 'MORNING') {
          startTime = '06:55';
        }
        if (level === 'FUND2' && day === 5 && shift === 'AFTERNOON') {
          startTime = '12:40';
        }

        let currentTime = startTime;
        for (let period = 1; period <= 6; period++) {
          let endTime = addMinutes(currentTime, duration);
          
          await prisma.timeSlot.create({
            data: {
              level,
              shift,
              dayOfWeek: day,
              period,
              startTime: currentTime,
              endTime: endTime,
            }
          });

          currentTime = endTime;
          
          // Intervals
          if ((level === 'INFANTIL' || level === 'FUND1') && period === 2) {
            currentTime = addMinutes(currentTime, 20); // 20m break after 2nd period
          } else if ((level === 'INFANTIL' || level === 'FUND1') && period === 4) {
            currentTime = addMinutes(currentTime, 20); // 20m break after 4th period
          } else if (level === 'FUND2' && period === 3) {
            currentTime = addMinutes(currentTime, 20); // 20m break after 3rd period
          }
        }
      }
    }
  }
  console.log('TimeSlots seeded.');
}

seed().catch(e => console.error(e)).finally(() => prisma.$disconnect());
