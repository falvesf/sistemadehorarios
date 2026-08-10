import styles from '../professores/professores.module.css';
import DisciplinasClient from './DisciplinasClient';
import { getSubjects } from './actions';

export default async function DisciplinasPage() {
  const subjects = await getSubjects();

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div>
          <h1>Disciplinas</h1>
          <p>Gerencie as disciplinas disponíveis no sistema.</p>
        </div>
      </header>

      <DisciplinasClient initialSubjects={subjects} />
    </div>
  );
}
