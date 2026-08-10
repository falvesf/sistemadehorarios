import styles from '../professores/professores.module.css';
import GeradorClient from './GeradorClient';
import { fetchCurrentSchedule, fetchSubjects, fetchClasses } from './actions';
import prisma from '@/lib/prisma';

export default async function GeradorPage() {
  const [schedules, teachers, subjects, classes] = await Promise.all([
    fetchCurrentSchedule(),
    prisma.teacher.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    fetchSubjects(),
    fetchClasses(),
  ]);

  const timeSlots = await prisma.timeSlot.findMany({
    orderBy: [{ level: 'asc' }, { shift: 'asc' }, { dayOfWeek: 'asc' }, { period: 'asc' }]
  });

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div>
          <h1>Motor Gerador de Horarios</h1>
          <p>Configure as opcoes e inicie o algoritmo inteligente para alocar as aulas.</p>
        </div>
      </header>

      <GeradorClient
        initialSchedules={schedules}
        teachers={teachers}
        timeSlots={timeSlots}
        subjects={subjects}
        classes={classes}
      />
    </div>
  );
}
