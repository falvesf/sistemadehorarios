import styles from '../professores/professores.module.css';
import GeradorClient from './GeradorClient';
import { fetchCurrentSchedule } from './actions';
import prisma from '@/lib/prisma';

export default async function GeradorPage() {
  const schedules = await fetchCurrentSchedule();
  const teachers = await prisma.teacher.findMany({
    orderBy: { name: 'asc' },
    select: { id: true, name: true }
  });
  const timeSlots = await prisma.timeSlot.findMany({
    orderBy: [{ level: 'asc' }, { shift: 'asc' }, { dayOfWeek: 'asc' }, { period: 'asc' }]
  });

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div>
          <h1>Motor Gerador de Horários</h1>
          <p>Configure as opções e inicie o algoritmo inteligente para alocar as aulas.</p>
        </div>
      </header>

      <GeradorClient initialSchedules={schedules} teachers={teachers} timeSlots={timeSlots} />
    </div>
  );
}
