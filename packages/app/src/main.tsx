import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { warnIfApiUnreachable } from './services/apiReachability';
import './styles.css';

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  // 若当前地址没有把 /api/* 代理到后端（页面能开但所有按钮都会"无反应"），给出醒目提示
  void warnIfApiUnreachable();
}
