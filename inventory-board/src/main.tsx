import React from 'react';
import ReactDOM from 'react-dom/client';
import { InventoryBoardApp } from './ui/InventoryBoardApp';
import './styles.css';

function mount() {
  const host = document.getElementById('inventory-board-root') ?? document.getElementById('root');
  if (!host) return;
  ReactDOM.createRoot(host).render(
    <React.StrictMode>
      <InventoryBoardApp />
    </React.StrictMode>,
  );
}

mount();

