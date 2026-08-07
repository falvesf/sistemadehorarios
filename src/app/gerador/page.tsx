import styles from '../professores/professores.module.css';
import GeradorClient from './GeradorClient';
import { fetchCurrentSchedule } from './actions';

export default async function GeradorPage() {
  const schedules = await fetchCurrentSchedule();

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div>
          <h1>Motor Gerador de Horários</h1>
          <p>Configure as opções e inicie o algoritmo inteligente para alocar as aulas.</p>
        </div>
      </header>

      <GeradorClient initialSchedules={schedules} />
    </div>
  );
}
