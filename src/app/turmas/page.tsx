import prisma from '@/lib/prisma';
import styles from '../professores/professores.module.css';
import TurmasClient from './TurmasClient';

export default async function TurmasPage() {
  const turmas = await prisma.class.findMany({
    orderBy: [
      { level: 'asc' },
      { name: 'asc' }
    ],
    include: {
      Curriculum: {
        include: { Subject: true, Teacher: true }
      }
    }
  });

  const teachers = await prisma.teacher.findMany({
    orderBy: { name: 'asc' },
    select: { id: true, name: true }
  });

  const subjects = await prisma.subject.findMany({
    orderBy: { name: 'asc' },
    select: { id: true, name: true }
  });

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div>
          <h1>Turmas e Grade Curricular</h1>
          <p>Gerencie as turmas, turnos e as disciplinas que cada uma possui.</p>
        </div>
        <button className="btn btn-primary">+ Nova Turma</button>
      </header>

      <TurmasClient turmas={turmas} teachers={teachers} subjects={subjects} />
    </div>
  );
}
