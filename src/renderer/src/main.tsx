import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './assets/main.css';

// Beacon's panel is a dark frosted card; drive shadcn's .dark token set.
document.documentElement.classList.add('dark');

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
