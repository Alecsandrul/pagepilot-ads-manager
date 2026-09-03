import { useCallback, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { initialRoute, navigate, type Route } from "./lib/routes";
import { supabase } from "./lib/supabase";
import Login from "./components/Login";
import Dashboard from "./components/Dashboard";
import ForgotPassword from "./components/ForgotPassword";
import ResetPassword from "./components/ResetPassword";

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [route, setRoute] = useState<Route>(initialRoute);

  const go = useCallback((r: Route) => {
    navigate(r);
    setRoute(r);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      // A recovery link CREATES a session. Without this the app treats it as
      // an ordinary sign in and drops the user on the dashboard with their
      // password still unchanged, which is the silent failure this route
      // exists to prevent.
      if (event === "PASSWORD_RECOVERY") setRoute("reset");
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // Back and forward buttons. Cheap to support, and the alternative is an app
  // whose address bar lies after the first navigation.
  useEffect(() => {
    const onPop = () => setRoute(initialRoute());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  if (!ready) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#8A8D91",
          fontSize: 14,
        }}
      >
        Loading…
      </div>
    );
  }

  // Recovery is resolved BEFORE the session check, deliberately: see above.
  if (route === "reset") {
    return <ResetPassword onDone={() => go("app")} onRequestNew={() => go("forgot")} />;
  }
  if (route === "forgot" && !session) {
    return <ForgotPassword onBack={() => go("app")} />;
  }
  return session ? <Dashboard /> : <Login onForgot={() => go("forgot")} />;
}
