import { AdminAuthProvider } from "@/auth/AdminAuthContext";
import AdminLayout from "@/layouts/AdminLayout";
import DeckCardsPage from "@/pages/DeckCardsPage";
import DecksPage from "@/pages/DecksPage";
import LoginPage from "@/pages/LoginPage";
import UsersPage from "@/pages/UsersPage";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

export default function App() {
  return (
    <AdminAuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<AdminLayout />}>
            <Route path="/" element={<Navigate to="/decks" replace />} />
            <Route path="/decks" element={<DecksPage />} />
            <Route path="/decks/:deckId/cards" element={<DeckCardsPage />} />
            <Route path="/users" element={<UsersPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AdminAuthProvider>
  );
}
