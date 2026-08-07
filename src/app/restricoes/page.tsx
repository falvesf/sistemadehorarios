import styles from '../professores/professores.module.css';
import RestricoesClient from './RestricoesClient';

export default function RestricoesPage() {
  return (
    <div className={styles.container}>
      <RestricoesClient />
    </div>
  );
}
