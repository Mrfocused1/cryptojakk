import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/poppins/latin-500.css';
import '@fontsource/poppins/latin-600.css';
import '@fontsource/poppins/latin-800.css';
import '@fontsource/poppins/latin-900.css';
import '@fontsource/poppins/latin-800-italic.css';
import '@fontsource/poppins/latin-900-italic.css';
import '@fontsource/roboto-slab/latin-900.css';
import '@fontsource/playfair-display/latin-800.css';
import '@fontsource/playfair-display/latin-700-italic.css';
import './src/styles.css';
import './src/game.css';
import { App } from './src/App';
import { boot } from './src/store';

boot();
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
