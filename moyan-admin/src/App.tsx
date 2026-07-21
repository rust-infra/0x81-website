import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom"
import DecksPage from "@/pages/DecksPage"
import LoginPage from "@/pages/LoginPage"
import UsersPage from "@/pages/UsersPage"

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/decks" element={<DecksPage />} />
        <Route path="/users" element={<UsersPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
