import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';

// Tokens first, then component styles that consume them. Order matters:
// App.css defines no values of its own, only rules that read these variables.
import './tokens.css';
import './App.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
