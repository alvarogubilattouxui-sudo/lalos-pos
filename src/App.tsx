import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppProvider } from "@/lib/store";
import { Layout } from "@/components/Layout";
import PosScreen from "@/screens/PosScreen";
import KitchenScreen from "@/screens/KitchenScreen";
import MenuAdminScreen from "@/screens/MenuAdminScreen";
import SettingsScreen from "@/screens/SettingsScreen";
import LocalScreen from "@/screens/LocalScreen";
import DayScreen from "@/screens/DayScreen";

export default function App() {
  return (
    <AppProvider>
      {/* HashRouter: funciona con el protocolo de archivos de Tauri sin configurar rutas */}
      <HashRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<PosScreen />} />
            <Route path="cocina" element={<KitchenScreen />} />
            <Route path="menu" element={<MenuAdminScreen />} />
            <Route path="config" element={<SettingsScreen />} />
            <Route path="local" element={<LocalScreen />} />
            <Route path="dia" element={<DayScreen />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </HashRouter>
    </AppProvider>
  );
}
