import { ThemeProvider } from '@vpb/ui';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App.tsx';
import './styles.css';

const container = document.getElementById('root');

/**
 * Fail loudly and specifically.
 *
 * The prototype used `document.getElementById("root")!` — a non-null assertion
 * over an element that, at the time, no HTML file actually contained. When the
 * assertion is wrong you get "Cannot read properties of null (reading
 * 'appendChild')" from deep inside React, which tells you nothing. This tells you
 * exactly what is wrong and where to look.
 */
if (!container) {
  throw new Error('Mount failed: no #root element in index.html.');
}

createRoot(container).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>,
);
