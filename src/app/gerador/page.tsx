import styles from '../professores/professores.module.css';
import GeradorClient from './GeradorClient';

export default function GeradorPage() {
  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div>
          <h1>Motor Gerador de Horários</h1>
          <p>Configure as opções e inicie o algoritmo inteligente para alocar as aulas.</p>
        </div>
        {/* Placeholder for top button if needed */}
      </header>

      <GeradorClient />
    </div>
  );
}
