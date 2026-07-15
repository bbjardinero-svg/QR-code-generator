import { useEffect, useState } from "react";
import { apiClient } from "./api";
import { DashboardPage } from "./dashboard-page";
import { LoginPage } from "./login-page";

type AppState = "checking" | "login" | "dashboard";

export function App() {
  const [state, setState] = useState<AppState>("checking");

  useEffect(() => {
    apiClient.session().then((authenticated) => setState(authenticated ? "dashboard" : "login")).catch(() => setState("login"));
  }, []);

  if (state === "checking") {
    return <main className="app-boot" aria-label="Loading EverQR"><span className="brand">EverQR</span></main>;
  }
  if (state === "login") {
    return <LoginPage onLogin={async (passphrase) => { await apiClient.login(passphrase); setState("dashboard"); }} />;
  }
  return (
    <DashboardPage
      api={apiClient}
      onCreate={() => window.alert("QR creator is loading in the next implementation checkpoint.")}
      onOpenQr={() => undefined}
      onSignOut={async () => { await apiClient.logout(); setState("login"); }}
    />
  );
}
