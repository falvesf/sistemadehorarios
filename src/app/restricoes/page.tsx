import prisma from '@/lib/prisma';
import styles from '../professores/professores.module.css';
import RestricoesClient from './RestricoesClient';

export default async function RestricoesPage() {
  const teachers = await prisma.teacher.findMany({
    orderBy: { name: 'asc' },
    select: { id: true, name: true }
  });

  const classes = await prisma.class.findMany({
    orderBy: [{ shift: 'asc' }, { name: 'asc' }],
    select: { id: true, name: true, shift: true }
  });

  const capelaRules = await prisma.schedule.findMany({
    where: { subject: { name: 'Capela' }, isFixed: true },
    include: { class: { select: { name: true, shift: true } }, teacher: { select: { name: true } } },
    orderBy: [{ dayOfWeek: 'asc' }, { period: 'asc' }]
  });

  const timeSlots = await prisma.timeSlot.findMany({
    orderBy: [{ level: 'asc' }, { shift: 'asc' }, { dayOfWeek: 'asc' }, { period: 'asc' }]
  });

  return (
    <div className={styles.container}>
      <RestricoesClient teachers={teachers} classes={classes} capelaRules={capelaRules} initialTimeSlots={timeSlots} />
    </div>
  );
}
