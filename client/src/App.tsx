/**
 * 路由表。
 *
 *   /                 管理台(场地清单)
 *   /m/:id            比赛配置
 *   /m/:id/control    iPad 控制台
 *   /m/:id/display    大屏
 *   /m/:id/overlay    OBS 叠加层(透明背景,贴左下角)
 */
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { I18nProvider } from './i18n';
import Control from './pages/Control';
import Dashboard from './pages/Dashboard';
import Display from './pages/Display';
import MatchSetup from './pages/MatchSetup';
import Overlay from './pages/Overlay';

export default function App() {
  return (
    <I18nProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/m/:id" element={<MatchSetup />} />
          <Route path="/m/:id/control" element={<Control />} />
          <Route path="/m/:id/display" element={<Display />} />
          <Route path="/m/:id/overlay" element={<Overlay />} />
          <Route path="*" element={<Dashboard />} />
        </Routes>
      </BrowserRouter>
    </I18nProvider>
  );
}
