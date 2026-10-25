// 画面の入口。URL のパスで、どの画面を出すかを決める(spec.md 6.2)
import { render } from "preact";
import { useEffect } from "preact/hooks";
import { ID_PATTERNS } from "../shared/ids";
import { NewSession } from "./pages/NewSession";
import { MyCalendar } from "./pages/MyCalendar";
import { SessionPage } from "./pages/SessionPage";
import { Top } from "./pages/Top";
import { navigate, usePath } from "./router";
import "./styles.css";

function App() {
  const path = usePath();

  const calendar = /^\/c\/([^/]+)$/.exec(path)?.[1];
  const session = /^\/s\/([^/]+)$/.exec(path)?.[1];
  const known =
    path === "/" ||
    path === "/new" ||
    (calendar !== undefined && ID_PATTERNS.calendar.test(calendar)) ||
    (session !== undefined && ID_PATTERNS.session.test(session));

  // 知らないパスはトップに戻す
  useEffect(() => {
    if (!known) navigate("/", { replace: true });
  }, [known]);

  if (path === "/new") return <NewSession />;
  if (calendar && known) return <MyCalendar key={calendar} id={calendar} />;
  if (session && known) return <SessionPage key={session} id={session} />;
  return <Top key={path} />;
}

const root = document.getElementById("app");
if (root) render(<App />, root);
