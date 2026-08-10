import prisma from '@/lib/prisma';
import styles from './professores.module.css';
import ProfessoresClient from './ProfessoresClient';

export default async function ProfessoresPage() {
  const professores = await prisma.teacher.findMany({
    orderBy: { name: 'asc' },
    include: {
      curriculums: {
        include: { class: true, subject: true }
      }
    }
  });
  const timeSlots = await prisma.timeSlot.findMany({
    orderBy: [{ level: 'asc' }, { shift: 'asc' }, { dayOfWeek: 'asc' }, { period: 'asc' }]
  });

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div>
          <h1>Professores</h1>
          <p>Gerencie os professores regentes e aulistas da escola.</p>
        </div>
      </header>

      <ProfessoresClient professores={professores} timeSlots={timeSlots} />
    </div>
  );
}
