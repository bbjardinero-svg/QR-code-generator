import { useEffect, useState } from "react";
import { apiClient } from "./api";
import { CreatePage } from "./create-page";
import { DashboardPage } from "./dashboard-page";
import { DetailPage } from "./detail-page";
import { LoginPage } from "./login-page";

type AuthState = "checking" | "login" | "ready";
type Route = { page: "dashboard" } | { page: "create" } | { page: "detail"; qrId: string };

function routeFromPath(pathname: string): Route {
  if (pathname === "/create") return { page: "create" };
  const detail = /^\/qr\/([^/]+)$/.exec(pathname);
  return detail ? { page: "detail", qrId: decodeURIComponent(detail[1]) } : { page: "dashboard" };
}

export function App() {
  const [auth, setAuth] = useState<AuthState>("checking");
  const [route, setRoute] = useState<Route>(() => routeFromPath(window.location.pathname));

  useEffect(() => {
    apiClient.session().then((authenticated) => setAuth(authenticated ? "ready" : "login")).catch(() => setAuth("login"));
  }, []);

  useEffect(() => {
    const navigateBack = () => setRoute(routeFromPath(window.location.pathname));
    window.addEventListener("popstate", navigateBack);
    return () => window.removeEventListener("popstate", navigateBack);
  }, []);

  function navigate(path: string) {
    window.history.pushState(null, "", path);
    setRoute(routeFromPath(path));
  }

  async function signOut() {
    await apiClient.logout();
    window.history.replaceState(null, "", "/");
    setRoute({ page: "dashboard" });
    setAuth("login");
  }

  if (auth === "checking") {
    return <main className="app-boot" aria-label="Loading EverQR"><span className="brand">EverQR</span></main>;
  }
  if (auth === "login") {
    return <LoginPage onLogin={async (passphrase) => { await apiClient.login(passphrase); setAuth("ready"); }} />;
  }
  if (route.page === "create") {
    return <CreatePage api={apiClient} onCancel={() => navigate("/")} onCreated={(id) => navigate(`/qr/${id}`)} onSignOut={() => void signOut()} />;
  }
  if (route.page === "detail") {
    return (
      <DetailPage
        qrId={route.qrId}
        api={apiClient}
        onBack={() => navigate("/")}
        onCreate={() => navigate("/create")}
        onDeleted={() => navigate("/")}
        onSignOut={() => void signOut()}
      />
    );
  }
  return (
    <DashboardPage
      api={apiClient}
      onCreate={() => navigate("/create")}
      onOpenQr={(id) => navigate(`/qr/${id}`)}
      onSignOut={() => void signOut()}
    />
  );
}
