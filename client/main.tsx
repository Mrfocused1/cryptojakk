import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/poppins/latin-800.css';
import '@fontsource/poppins/latin-900.css';
import './src/styles.css';
import { App } from './src/App';
import { boot } from './src/store';

boot();
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
