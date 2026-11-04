import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/app.css';
import { AppController } from './app/AppController.ts';
import { AppProvider } from './app/context.tsx';
import { App, ErrorBoundary } from './ui/App.tsx';

const app = new AppController();
// Exposed for diagnostics and automated tests.
(window as unknown as { neuroform: AppController }).neuroform = app;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary label="NEUROFORM">
      <AppProvider app={app}>
        <App />
      </AppProvider>
    </ErrorBoundary>
  </StrictMode>,
);
