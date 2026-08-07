import prisma from '@/lib/prisma';
import styles from '../professores/professores.module.css';
import RestricoesClient from './RestricoesClient';

export default async function RestricoesPage() {
  const teachers = await prisma.teacher.findMany({
    orderBy: { name: 'asc' },
    select: { id: true, name: true }
  });

  return (
    <div className={styles.container}>
      <RestricoesClient teachers={teachers} />
    </div>
  );
}
