import { seedSnapshot } from "../lib/seedSnapshot";

export default function Home() {
  return (
    <main>
      <h1>GammaScope</h1>
      <p>Mode: {seedSnapshot.mode}</p>
      <p>Symbol: {seedSnapshot.symbol}</p>
      <p>Rows: {seedSnapshot.rows.length}</p>
    </main>
  );
}
