import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { announceAppUpdate } from './presentation/pwa/appUpdate';

// REL-3: новая версия не активируется сама. Когда обновление готово, сообщаем
// интерфейсу, а `updateSW(true)` вызывается только после нажатия «Обновить».
const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    announceAppUpdate(() => {
      void updateSW(true);
    });
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
