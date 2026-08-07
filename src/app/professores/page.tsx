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

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div>
          <h1>Professores</h1>
          <p>Gerencie os professores regentes e aulistas da escola.</p>
        </div>
        <button className="btn btn-primary">+ Novo Professor</button>
      </header>

      <ProfessoresClient professores={professores} />
    </div>
  );
}
