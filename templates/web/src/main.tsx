import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { cloudsforgeHosts } from './hosts.ts';

function App(): JSX.Element {
  const hosts = cloudsforgeHosts();
  return (
    <main>
      <h1>__NAME__</h1>
      <p>identity: {hosts.identity}</p>
    </main>
  );
}

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
